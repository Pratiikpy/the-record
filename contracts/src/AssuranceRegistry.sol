// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AssuranceRegistry — the practitioner is a program, and it may refuse.
/// @notice A procedure is a frozen, publicly-published program identified by its
///         image hash: the hash IS the engagement letter. Evidence enters the
///         enclave and never leaves; only the conclusion is published.
/// @dev    Two design decisions carry the whole thing:
///
///         1. CLEAN and EXCEPTION are stored through the SAME function and the
///            same storage. A registry with a happy path is a registry that can
///            be leaned on.
///
///         2. Nothing compels a client to relay a conclusion it dislikes, so
///            suppression is the real attack — not forgery. The answer is a
///            pre-committed schedule plus a permissionless `lapse()`: a period
///            that passes with no conclusion becomes adverse on the record,
///            callable by anyone. A client can withhold a bad result. It cannot
///            manufacture a good one on time.
contract AssuranceRegistry {
    // -------------------------------------------------------------- types --

    enum Opinion {
        NONE, // no conclusion recorded
        CLEAN, // tested, held
        EXCEPTION, // tested, breached
        DISCLAIMER, // insufficient evidence to conclude
        LAPSED // deadline passed with no conclusion at all
    }

    /// @param codeHash    reproducible image hash — the procedure itself
    /// @param manifestHash hash of the human-readable manifest (assertion, sources, thresholds)
    /// @param periodLength seconds per reporting period
    /// @param graceSeconds how long after a period ends a conclusion may still arrive
    struct Procedure {
        bytes32 codeHash;
        bytes32 manifestHash;
        address subject;
        uint64 periodLength;
        uint64 graceSeconds;
        uint64 startedAt;
        bool active;
    }

    struct Conclusion {
        Opinion opinion;
        bytes32 evidenceDigest;
        uint32 exceptionCount;
        address reporter;
        uint64 recordedAt;
    }

    // ------------------------------------------------------------- storage --

    mapping(bytes32 procedureId => Procedure) private _procedures;
    mapping(bytes32 procedureId => mapping(uint64 period => Conclusion)) private _conclusions;
    mapping(bytes32 procedureId => uint64) public lastConcludedPeriod;

    /// @notice Signers whose conclusions are accepted for a procedure. In
    ///         production this is an onchain-registered TEE identity; the
    ///         deployer bootstraps it and renounces.
    mapping(bytes32 procedureId => mapping(address => bool)) public isReporter;

    address public admin;

    // -------------------------------------------------------------- events --

    event ProcedureRegistered(
        bytes32 indexed procedureId,
        bytes32 indexed codeHash,
        address indexed subject,
        bytes32 manifestHash,
        uint64 periodLength
    );
    event Concluded(
        bytes32 indexed procedureId,
        uint64 indexed period,
        Opinion opinion,
        bytes32 evidenceDigest,
        uint32 exceptionCount,
        address reporter
    );
    event Lapsed(bytes32 indexed procedureId, uint64 indexed period, address caller);
    event ReporterSet(bytes32 indexed procedureId, address indexed reporter, bool allowed);
    event ProcedureDeactivated(bytes32 indexed procedureId);

    // -------------------------------------------------------------- errors --

    error NotAdmin();
    error NotReporter();
    error ZeroAddress();
    error UnknownProcedure();
    error ProcedureExists();
    error InvalidPeriodLength();
    error AlreadyConcluded();
    /// @dev NONE and LAPSED are outcomes the registry derives, never ones a
    ///      reporter may assert.
    error InvalidOpinion();
    /// @dev A period cannot lapse while it is still open, or still in grace.
    error PeriodNotExpired();
    error PeriodNotStarted();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
    }

    // ----------------------------------------------------------- registry --

    function procedureId(bytes32 codeHash, address subject) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(codeHash, subject));
    }

    function registerProcedure(
        bytes32 codeHash,
        address subject,
        bytes32 manifestHash,
        uint64 periodLength,
        uint64 graceSeconds
    ) external onlyAdmin returns (bytes32 id) {
        if (subject == address(0)) revert ZeroAddress();
        if (periodLength == 0) revert InvalidPeriodLength();

        id = procedureId(codeHash, subject);
        if (_procedures[id].periodLength != 0) revert ProcedureExists();

        _procedures[id] = Procedure({
            codeHash: codeHash,
            manifestHash: manifestHash,
            subject: subject,
            periodLength: periodLength,
            graceSeconds: graceSeconds,
            startedAt: uint64(block.timestamp),
            active: true
        });
        isReporter[id][msg.sender] = true;

        emit ProcedureRegistered(id, codeHash, subject, manifestHash, periodLength);
        emit ReporterSet(id, msg.sender, true);
    }

    function setReporter(bytes32 id, address reporter, bool allowed) external onlyAdmin {
        if (_procedures[id].periodLength == 0) revert UnknownProcedure();
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[id][reporter] = allowed;
        emit ReporterSet(id, reporter, allowed);
    }

    function deactivate(bytes32 id) external onlyAdmin {
        if (_procedures[id].periodLength == 0) revert UnknownProcedure();
        _procedures[id].active = false;
        emit ProcedureDeactivated(id);
    }

    // --------------------------------------------------------- conclusions --

    /// @notice Record a conclusion for a period. CLEAN, EXCEPTION and DISCLAIMER
    ///         all travel this one path — there is no separate happy route.
    function conclude(
        bytes32 id,
        uint64 period,
        Opinion opinion,
        bytes32 evidenceDigest,
        uint32 exceptionCount
    ) external {
        Procedure storage p = _procedures[id];
        if (p.periodLength == 0) revert UnknownProcedure();
        if (!isReporter[id][msg.sender]) revert NotReporter();
        if (opinion == Opinion.NONE || opinion == Opinion.LAPSED) revert InvalidOpinion();
        if (period > currentPeriod(id)) revert PeriodNotStarted();
        if (_conclusions[id][period].opinion != Opinion.NONE) revert AlreadyConcluded();

        _conclusions[id][period] = Conclusion({
            opinion: opinion,
            evidenceDigest: evidenceDigest,
            exceptionCount: exceptionCount,
            reporter: msg.sender,
            recordedAt: uint64(block.timestamp)
        });
        if (period > lastConcludedPeriod[id]) lastConcludedPeriod[id] = period;

        emit Concluded(id, period, opinion, evidenceDigest, exceptionCount, msg.sender);
    }

    /// @notice Mark a period adverse because no conclusion arrived in time.
    /// @dev    Permissionless by design. The subject can withhold a bad result,
    ///         but withholding is itself the record — and anyone at all can
    ///         write it once the grace window closes.
    function lapse(bytes32 id, uint64 period) external {
        Procedure storage p = _procedures[id];
        if (p.periodLength == 0) revert UnknownProcedure();
        if (_conclusions[id][period].opinion != Opinion.NONE) revert AlreadyConcluded();

        uint256 deadline =
            uint256(p.startedAt) + (uint256(period) + 1) * p.periodLength + p.graceSeconds;
        if (block.timestamp <= deadline) revert PeriodNotExpired();

        _conclusions[id][period] = Conclusion({
            opinion: Opinion.LAPSED,
            evidenceDigest: bytes32(0),
            exceptionCount: 0,
            reporter: msg.sender,
            recordedAt: uint64(block.timestamp)
        });

        emit Lapsed(id, period, msg.sender);
    }

    // --------------------------------------------------------------- views --

    function currentPeriod(bytes32 id) public view returns (uint64) {
        Procedure storage p = _procedures[id];
        if (p.periodLength == 0) revert UnknownProcedure();
        return uint64((block.timestamp - p.startedAt) / p.periodLength);
    }

    function procedureOf(bytes32 id) external view returns (Procedure memory) {
        return _procedures[id];
    }

    function conclusionOf(bytes32 id, uint64 period) external view returns (Conclusion memory) {
        return _conclusions[id][period];
    }

    /// @notice Coverage over a window: how many periods concluded at all, and how
    ///         many of those were adverse.
    /// @dev    `concluded` is the denominator. A caller must not read
    ///         `adverse == 0` as good without checking it — an unreported
    ///         procedure is unknown, not clean.
    function coverage(bytes32 id, uint64 fromPeriod, uint64 toPeriod)
        external
        view
        returns (uint64 concluded, uint64 clean, uint64 adverse, uint64 missing)
    {
        if (_procedures[id].periodLength == 0) revert UnknownProcedure();
        for (uint64 i = fromPeriod; i <= toPeriod; ++i) {
            Opinion o = _conclusions[id][i].opinion;
            if (o == Opinion.NONE) {
                ++missing;
            } else {
                ++concluded;
                if (o == Opinion.CLEAN) ++clean;
                else ++adverse; // EXCEPTION, DISCLAIMER and LAPSED are all adverse
            }
        }
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
    }
}
