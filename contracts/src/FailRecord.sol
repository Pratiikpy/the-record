// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title FailRecord — obligations that were owed, and provably were not performed.
/// @notice Credit in traditional finance is built on default data, not reserve
///         data. Crypto records what happened and never what didn't, so an
///         agent who defaulted last month is indistinguishable from one who
///         never has. Everyone builds proof-of-reserves; nobody builds the
///         thing that names defaulters.
/// @dev    Every adjudication cites the FDC round that established it, so a
///         reader re-derives the verdict from public data rather than trusting
///         this contract. Append-only: an obligation is adjudicated once.
contract FailRecord {
    // -------------------------------------------------------------- types --

    enum Outcome {
        NONE,
        PERFORMED, // settled before the deadline
        DEFAULTED // a nonexistence proof established the payment never happened
    }

    /// @param obligor    the party that owed performance (e.g. an agent vault)
    /// @param roundId    FDC attestation round that established the outcome
    /// @param amount     value owed, in the obligation's own minimal units
    struct Adjudication {
        Outcome outcome;
        address obligor;
        address obligee;
        uint256 amount;
        uint256 roundId;
        uint64 deadline;
        uint64 adjudicatedAt;
    }

    struct Standing {
        uint64 performed;
        uint64 defaulted;
        uint256 valueDefaulted;
        uint64 lastDefaultAt;
    }

    // ------------------------------------------------------------- storage --

    /// @dev keccak256(source, obligationId) => adjudication
    mapping(bytes32 obligationKey => Adjudication) private _adjudications;
    mapping(address obligor => Standing) private _standing;
    mapping(address obligor => bytes32[]) private _defaultsOf;

    uint256 public totalAdjudications;
    uint256 public totalDefaults;

    mapping(address => bool) public isAdjudicator;
    address public admin;

    // -------------------------------------------------------------- events --

    event Adjudicated(
        bytes32 indexed obligationKey,
        address indexed obligor,
        address indexed obligee,
        Outcome outcome,
        uint256 amount,
        uint256 roundId
    );
    event AdjudicatorSet(address indexed adjudicator, bool allowed);
    event AdminTransferred(address indexed from, address indexed to);

    // -------------------------------------------------------------- errors --

    error NotAdmin();
    error NotAdjudicator();
    error ZeroAddress();
    error AlreadyAdjudicated();
    /// @dev NONE is the absence of a verdict; writing it would be a lie.
    error OutcomeRequired();
    /// @dev A verdict with no citable round cannot be re-derived by a reader,
    ///      which is the only reason to believe this contract at all.
    error CitationRequired();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAdjudicator() {
        if (!isAdjudicator[msg.sender]) revert NotAdjudicator();
        _;
    }

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        isAdjudicator[initialAdmin] = true;
        emit AdminTransferred(address(0), initialAdmin);
        emit AdjudicatorSet(initialAdmin, true);
    }

    // ----------------------------------------------------------------- key --

    /// @notice Namespaced so the same numeric id on two asset managers, or on a
    ///         different chain entirely, can never collide.
    function obligationKey(address source, uint256 obligationId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(source, obligationId));
    }

    // ----------------------------------------------------------- mutations --

    /// @notice Record the outcome of one obligation, citing the FDC round.
    /// @dev    Performance is recorded as well as default. A register that only
    ///         stores failures cannot support a Good Standing claim, and a
    ///         denominator nobody can see is not evidence.
    function adjudicate(
        address source,
        uint256 obligationId,
        Outcome outcome,
        address obligor,
        address obligee,
        uint256 amount,
        uint256 roundId,
        uint64 deadline
    ) external onlyAdjudicator returns (bytes32 key) {
        if (outcome == Outcome.NONE) revert OutcomeRequired();
        if (obligor == address(0)) revert ZeroAddress();
        if (roundId == 0) revert CitationRequired();

        key = obligationKey(source, obligationId);
        if (_adjudications[key].outcome != Outcome.NONE) revert AlreadyAdjudicated();

        _adjudications[key] = Adjudication({
            outcome: outcome,
            obligor: obligor,
            obligee: obligee,
            amount: amount,
            roundId: roundId,
            deadline: deadline,
            adjudicatedAt: uint64(block.timestamp)
        });

        Standing storage s = _standing[obligor];
        unchecked {
            ++totalAdjudications;
            if (outcome == Outcome.DEFAULTED) {
                ++s.defaulted;
                ++totalDefaults;
                s.valueDefaulted += amount;
                s.lastDefaultAt = uint64(block.timestamp);
                _defaultsOf[obligor].push(key);
            } else {
                ++s.performed;
            }
        }

        emit Adjudicated(key, obligor, obligee, outcome, amount, roundId);
    }

    function setAdjudicator(address adjudicator, bool allowed) external onlyAdmin {
        if (adjudicator == address(0)) revert ZeroAddress();
        isAdjudicator[adjudicator] = allowed;
        emit AdjudicatorSet(adjudicator, allowed);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // --------------------------------------------------------------- views --

    function adjudicationOf(address source, uint256 obligationId)
        external
        view
        returns (Adjudication memory)
    {
        return _adjudications[obligationKey(source, obligationId)];
    }

    function standingOf(address obligor) external view returns (Standing memory) {
        return _standing[obligor];
    }

    /// @notice Fail rate in basis points. Returns 0 when nothing is on record —
    ///         which a caller must NOT read as a clean record.
    ///         `total == 0` is "unknown", not "good"; check `total` first.
    function failRateBps(address obligor) external view returns (uint256 bps, uint256 total) {
        Standing storage s = _standing[obligor];
        total = uint256(s.performed) + uint256(s.defaulted);
        if (total == 0) return (0, 0);
        bps = (uint256(s.defaulted) * 10_000) / total;
    }

    function defaultCount(address obligor) external view returns (uint256) {
        return _defaultsOf[obligor].length;
    }

    function defaultAt(address obligor, uint256 i) external view returns (Adjudication memory) {
        return _adjudications[_defaultsOf[obligor][i]];
    }
}
