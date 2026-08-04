// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ReproRegistry — is a running TEE image the source code it claims to be?
/// @notice Flare's own tooling records the gap this closes, verbatim:
///         "Code hash is from proxy /info response — not independently verified
///         against attestation." A contract today can prove a signature came
///         from a *registered* machine, but has no way to ask whether that
///         machine's code was ever independently rebuilt from published source.
/// @dev    Append-only by construction. A verdict is never overwritten, only
///         superseded, so the history of what was believed and when survives.
contract ReproRegistry {
    // -------------------------------------------------------------- types --

    enum Verdict {
        NONE, // never assessed
        NO_KNOWN_SOURCE, // no source revision claimed for this image
        SIMULATED, // attested to a simulator; binds to no source
        UNREPRODUCIBLE, // source declared, but it cannot build deterministically
        DIVERGED, // rebuilt, and the digest does NOT match
        REPRODUCED // rebuilt, and the digest matches
    }

    /// @param repo        forge repository, e.g. "flare-foundation/fce-sign"
    /// @param commitSha   immutable commit, resolved via FDC Web2Json — never a tag
    /// @param recipeHash  hash of the declared build recipe
    struct SourceClaim {
        string repo;
        string commitSha;
        bytes32 recipeHash;
        address claimant;
        uint64 claimedAt;
    }

    struct Assessment {
        Verdict verdict;
        bytes32 rebuiltDigest;
        /// @dev Which layer/path diverged. Empty unless verdict == DIVERGED.
        string divergence;
        address rebuilder;
        uint64 assessedAt;
    }

    // ------------------------------------------------------------- storage --

    /// @notice Anyone may claim a source revision for any image — including on
    ///         someone else's behalf. No subject can suppress a record by
    ///         withholding permission.
    mapping(bytes32 codeHash => SourceClaim[]) private _claims;
    mapping(bytes32 codeHash => Assessment[]) private _assessments;

    /// @notice Rebuilders permitted to publish assessments. Bootstrapped by the
    ///         deployer; the endgame is an FCE TEE identity signing its own
    ///         rebuilds, at which point the operator key is renounced.
    mapping(address => bool) public isRebuilder;
    address public admin;

    // -------------------------------------------------------------- events --

    event SourceClaimed(
        bytes32 indexed codeHash,
        address indexed claimant,
        string repo,
        string commitSha,
        bytes32 recipeHash
    );
    event Assessed(
        bytes32 indexed codeHash,
        address indexed rebuilder,
        Verdict verdict,
        bytes32 rebuiltDigest,
        string divergence
    );
    event RebuilderSet(address indexed rebuilder, bool allowed);
    event AdminTransferred(address indexed from, address indexed to);

    // -------------------------------------------------------------- errors --

    error NotAdmin();
    error NotRebuilder();
    error EmptyCodeHash();
    error EmptyRepo();
    error EmptyCommit();
    /// @dev A REPRODUCED or DIVERGED verdict is meaningless without a claim to
    ///      compare against — refusing is safer than recording a floating verdict.
    error NoSourceClaim();
    /// @dev SIMULATED and NO_KNOWN_SOURCE describe the absence of a comparison,
    ///      so a rebuilt digest alongside them is a contradiction.
    error DigestWithoutComparison();
    error ZeroAddress();

    // ----------------------------------------------------------- modifiers --

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyRebuilder() {
        if (!isRebuilder[msg.sender]) revert NotRebuilder();
        _;
    }

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        isRebuilder[initialAdmin] = true;
        emit AdminTransferred(address(0), initialAdmin);
        emit RebuilderSet(initialAdmin, true);
    }

    // ----------------------------------------------------------- mutations --

    /// @notice Claim that `codeHash` was built from `repo` at `commitSha`.
    /// @dev    Permissionless on purpose. Claims accumulate; a competing claim
    ///         does not erase an earlier one, it sits beside it.
    function claimSource(
        bytes32 codeHash,
        string calldata repo,
        string calldata commitSha,
        bytes32 recipeHash
    ) external {
        if (codeHash == bytes32(0)) revert EmptyCodeHash();
        if (bytes(repo).length == 0) revert EmptyRepo();
        if (bytes(commitSha).length == 0) revert EmptyCommit();

        _claims[codeHash].push(
            SourceClaim({
                repo: repo,
                commitSha: commitSha,
                recipeHash: recipeHash,
                claimant: msg.sender,
                claimedAt: uint64(block.timestamp)
            })
        );
        emit SourceClaimed(codeHash, msg.sender, repo, commitSha, recipeHash);
    }

    /// @notice Publish the outcome of an independent rebuild.
    /// @param divergence For DIVERGED, the layer/path that differed. An
    ///        unattributed DIVERGED cannot distinguish honest toolchain
    ///        nondeterminism from a substituted binary, so it is required.
    function assess(
        bytes32 codeHash,
        Verdict verdict,
        bytes32 rebuiltDigest,
        string calldata divergence
    ) external onlyRebuilder {
        if (codeHash == bytes32(0)) revert EmptyCodeHash();

        if (verdict == Verdict.REPRODUCED || verdict == Verdict.DIVERGED) {
            if (_claims[codeHash].length == 0) revert NoSourceClaim();
        } else if (rebuiltDigest != bytes32(0)) {
            revert DigestWithoutComparison();
        }

        _assessments[codeHash].push(
            Assessment({
                verdict: verdict,
                rebuiltDigest: rebuiltDigest,
                divergence: divergence,
                rebuilder: msg.sender,
                assessedAt: uint64(block.timestamp)
            })
        );
        emit Assessed(codeHash, msg.sender, verdict, rebuiltDigest, divergence);
    }

    function setRebuilder(address rebuilder, bool allowed) external onlyAdmin {
        if (rebuilder == address(0)) revert ZeroAddress();
        isRebuilder[rebuilder] = allowed;
        emit RebuilderSet(rebuilder, allowed);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // --------------------------------------------------------------- views --

    /// @notice The current verdict for an image: the most recent assessment.
    function reproStatus(bytes32 codeHash)
        external
        view
        returns (Verdict verdict, bytes32 rebuiltDigest, uint64 assessedAt, uint256 rebuilderCount)
    {
        Assessment[] storage a = _assessments[codeHash];
        if (a.length == 0) return (Verdict.NONE, bytes32(0), 0, 0);

        Assessment storage latest = a[a.length - 1];

        // Distinct rebuilders who agree with the standing verdict. One honest
        // rebuilder anywhere is enough to expose a false REPRODUCED, so the
        // count is the useful signal, not the boolean.
        uint256 n;
        for (uint256 i; i < a.length; ++i) {
            if (a[i].verdict == latest.verdict) ++n;
        }
        return (latest.verdict, latest.rebuiltDigest, latest.assessedAt, n);
    }

    /// @notice True only for an image independently rebuilt to a matching digest.
    /// @dev    Deliberately strict: NONE, SIMULATED and NO_KNOWN_SOURCE are all
    ///         false. A consuming protocol can gate execution on this.
    function isReproduced(bytes32 codeHash) external view returns (bool) {
        Assessment[] storage a = _assessments[codeHash];
        if (a.length == 0) return false;
        return a[a.length - 1].verdict == Verdict.REPRODUCED;
    }

    function claimCount(bytes32 codeHash) external view returns (uint256) {
        return _claims[codeHash].length;
    }

    function claimAt(bytes32 codeHash, uint256 i) external view returns (SourceClaim memory) {
        return _claims[codeHash][i];
    }

    function assessmentCount(bytes32 codeHash) external view returns (uint256) {
        return _assessments[codeHash].length;
    }

    function assessmentAt(bytes32 codeHash, uint256 i) external view returns (Assessment memory) {
        return _assessments[codeHash][i];
    }
}
