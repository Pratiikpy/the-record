// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReproRegistry} from "../src/ReproRegistry.sol";

contract ReproRegistryTest is Test {
    ReproRegistry internal reg;

    address internal admin = address(0xA11CE);
    address internal rebuilder = address(0xB0B);
    address internal stranger = address(0xBEEF);

    /// Real values observed on Coston2 at block 33,607,820.
    bytes32 internal constant SIMULATED =
        0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2;
    bytes32 internal constant REAL =
        0x5076a65e61e28a6f1660bd96b4df44d561cc27eaaeec30f17b09dc61c32730d1;

    function setUp() public {
        reg = new ReproRegistry(admin);
        vm.prank(admin);
        reg.setRebuilder(rebuilder, true);
    }

    // ------------------------------------------------------------ claiming --

    function test_anyoneMayClaimSource_evenForSomeoneElsesImage() public {
        vm.prank(stranger);
        reg.claimSource(REAL, "flare-foundation/fce-sign", "abc123", keccak256("recipe"));

        assertEq(reg.claimCount(REAL), 1);
        ReproRegistry.SourceClaim memory c = reg.claimAt(REAL, 0);
        assertEq(c.claimant, stranger);
        assertEq(c.repo, "flare-foundation/fce-sign");
    }

    function test_claimsAccumulate_competingClaimDoesNotEraseEarlier() public {
        vm.prank(stranger);
        reg.claimSource(REAL, "a/b", "sha-1", bytes32(0));
        vm.prank(rebuilder);
        reg.claimSource(REAL, "c/d", "sha-2", bytes32(0));

        assertEq(reg.claimCount(REAL), 2);
        assertEq(reg.claimAt(REAL, 0).commitSha, "sha-1");
        assertEq(reg.claimAt(REAL, 1).commitSha, "sha-2");
    }

    function test_rejectsEmptyInputs() public {
        vm.expectRevert(ReproRegistry.EmptyCodeHash.selector);
        reg.claimSource(bytes32(0), "a/b", "sha", bytes32(0));

        vm.expectRevert(ReproRegistry.EmptyRepo.selector);
        reg.claimSource(REAL, "", "sha", bytes32(0));

        vm.expectRevert(ReproRegistry.EmptyCommit.selector);
        reg.claimSource(REAL, "a/b", "", bytes32(0));
    }

    // ---------------------------------------------------------- assessment --

    function test_onlyRebuilderMayAssess() public {
        vm.prank(stranger);
        vm.expectRevert(ReproRegistry.NotRebuilder.selector);
        reg.assess(SIMULATED, ReproRegistry.Verdict.SIMULATED, bytes32(0), "");
    }

    function test_reproducedRequiresASourceClaim() public {
        vm.prank(rebuilder);
        vm.expectRevert(ReproRegistry.NoSourceClaim.selector);
        reg.assess(REAL, ReproRegistry.Verdict.REPRODUCED, REAL, "");
    }

    function test_divergedRequiresASourceClaim() public {
        vm.prank(rebuilder);
        vm.expectRevert(ReproRegistry.NoSourceClaim.selector);
        reg.assess(REAL, ReproRegistry.Verdict.DIVERGED, bytes32(uint256(1)), "layer 3");
    }

    function test_simulatedMustNotCarryARebuiltDigest() public {
        // SIMULATED means "no comparison happened". A digest beside it is a
        // contradiction, and would let a caller fake a comparison.
        vm.prank(rebuilder);
        vm.expectRevert(ReproRegistry.DigestWithoutComparison.selector);
        reg.assess(SIMULATED, ReproRegistry.Verdict.SIMULATED, REAL, "");
    }

    function test_simulatedWithoutDigestIsAccepted() public {
        vm.prank(rebuilder);
        reg.assess(SIMULATED, ReproRegistry.Verdict.SIMULATED, bytes32(0), "");

        (ReproRegistry.Verdict v,,, uint256 n) = reg.reproStatus(SIMULATED);
        assertEq(uint256(v), uint256(ReproRegistry.Verdict.SIMULATED));
        assertEq(n, 1);
        assertFalse(reg.isReproduced(SIMULATED));
    }

    function test_reproducedFlowEndToEnd() public {
        vm.prank(stranger);
        reg.claimSource(REAL, "flare-foundation/tee-node", "v0.0.24", keccak256("buildx"));

        vm.prank(rebuilder);
        reg.assess(REAL, ReproRegistry.Verdict.REPRODUCED, REAL, "");

        (ReproRegistry.Verdict v, bytes32 digest,, uint256 n) = reg.reproStatus(REAL);
        assertEq(uint256(v), uint256(ReproRegistry.Verdict.REPRODUCED));
        assertEq(digest, REAL);
        assertEq(n, 1);
        assertTrue(reg.isReproduced(REAL));
    }

    function test_divergenceIsRecordedAndKillsIsReproduced() public {
        vm.prank(stranger);
        reg.claimSource(REAL, "a/b", "sha", bytes32(0));

        vm.prank(rebuilder);
        reg.assess(REAL, ReproRegistry.Verdict.REPRODUCED, REAL, "");
        assertTrue(reg.isReproduced(REAL));

        // A later rebuilder disagrees. The newest verdict stands.
        vm.prank(admin);
        reg.assess(REAL, ReproRegistry.Verdict.DIVERGED, bytes32(uint256(0xdead)), "layer 4: /usr/lib");

        assertFalse(reg.isReproduced(REAL), "a divergence must revoke reproduced status");
        (ReproRegistry.Verdict v,,,) = reg.reproStatus(REAL);
        assertEq(uint256(v), uint256(ReproRegistry.Verdict.DIVERGED));
    }

    function test_historyIsAppendOnly_supersededNeverOverwritten() public {
        vm.prank(stranger);
        reg.claimSource(REAL, "a/b", "sha", bytes32(0));

        vm.prank(rebuilder);
        reg.assess(REAL, ReproRegistry.Verdict.REPRODUCED, REAL, "");
        vm.prank(rebuilder);
        reg.assess(REAL, ReproRegistry.Verdict.DIVERGED, bytes32(uint256(1)), "why");

        assertEq(reg.assessmentCount(REAL), 2);
        // the earlier belief survives, which is the point of a record
        assertEq(uint256(reg.assessmentAt(REAL, 0).verdict), uint256(ReproRegistry.Verdict.REPRODUCED));
    }

    function test_rebuilderCountOnlyTalliesAgreementWithStandingVerdict() public {
        vm.prank(stranger);
        reg.claimSource(REAL, "a/b", "sha", bytes32(0));

        vm.prank(rebuilder);
        reg.assess(REAL, ReproRegistry.Verdict.REPRODUCED, REAL, "");
        vm.prank(admin);
        reg.assess(REAL, ReproRegistry.Verdict.REPRODUCED, REAL, "");
        vm.prank(rebuilder);
        reg.assess(REAL, ReproRegistry.Verdict.DIVERGED, bytes32(uint256(9)), "d");

        (,,, uint256 n) = reg.reproStatus(REAL);
        assertEq(n, 1, "only the single DIVERGED assessment agrees with the standing verdict");
    }

    // ---------------------------------------------------- unassessed images --

    function test_unknownImageIsNeverReproduced() public view {
        assertFalse(reg.isReproduced(keccak256("never seen")));
        (ReproRegistry.Verdict v,, uint64 at, uint256 n) = reg.reproStatus(keccak256("never seen"));
        assertEq(uint256(v), uint256(ReproRegistry.Verdict.NONE));
        assertEq(at, 0);
        assertEq(n, 0);
    }

    // -------------------------------------------------------------- admin --

    function test_adminTransferAndRevocation() public {
        vm.prank(admin);
        reg.setRebuilder(rebuilder, false);

        vm.prank(rebuilder);
        vm.expectRevert(ReproRegistry.NotRebuilder.selector);
        reg.assess(SIMULATED, ReproRegistry.Verdict.SIMULATED, bytes32(0), "");

        vm.prank(admin);
        reg.transferAdmin(stranger);
        assertEq(reg.admin(), stranger);

        vm.prank(admin);
        vm.expectRevert(ReproRegistry.NotAdmin.selector);
        reg.setRebuilder(rebuilder, true);
    }

    function test_rejectsZeroAddresses() public {
        vm.expectRevert(ReproRegistry.ZeroAddress.selector);
        new ReproRegistry(address(0));

        vm.prank(admin);
        vm.expectRevert(ReproRegistry.ZeroAddress.selector);
        reg.setRebuilder(address(0), true);

        vm.prank(admin);
        vm.expectRevert(ReproRegistry.ZeroAddress.selector);
        reg.transferAdmin(address(0));
    }

    // --------------------------------------------------------------- fuzz --

    function testFuzz_isReproducedAlwaysFalseWithoutAMatchingRebuild(
        bytes32 codeHash,
        bytes32 digest
    ) public {
        vm.assume(codeHash != bytes32(0));
        vm.prank(stranger);
        reg.claimSource(codeHash, "a/b", "sha", bytes32(0));

        vm.prank(rebuilder);
        if (digest == codeHash) {
            reg.assess(codeHash, ReproRegistry.Verdict.REPRODUCED, digest, "");
            assertTrue(reg.isReproduced(codeHash));
        } else {
            reg.assess(codeHash, ReproRegistry.Verdict.DIVERGED, digest, "fuzz");
            assertFalse(reg.isReproduced(codeHash));
        }
    }

    function testFuzz_nonRebuilderCanNeverAssess(address who) public {
        vm.assume(who != admin && who != rebuilder);
        vm.prank(who);
        vm.expectRevert(ReproRegistry.NotRebuilder.selector);
        reg.assess(SIMULATED, ReproRegistry.Verdict.SIMULATED, bytes32(0), "");
    }
}
