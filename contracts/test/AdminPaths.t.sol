// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssuranceRegistry} from "../src/AssuranceRegistry.sol";
import {FailRecord} from "../src/FailRecord.sol";
import {ReproRegistry} from "../src/ReproRegistry.sol";

/**
 * Administrative and error paths.
 *
 * These are the branches that never run in a happy-path demo and are exactly
 * where an access-control mistake hides. A registry whose write path is
 * well-tested but whose admin path is not is a registry with an unguarded door.
 */
contract AdminPathsTest is Test {
    address internal admin = address(0xA11CE);
    address internal other = address(0xB0B);
    address internal stranger = address(0xBEEF);
    address internal subject = address(0x5AFE);

    AssuranceRegistry internal ar;
    FailRecord internal fr;
    ReproRegistry internal rr;

    bytes32 internal constant CODE = keccak256("image");
    uint64 internal constant DAY = 1 days;

    function setUp() public {
        vm.warp(1_000_000);
        ar = new AssuranceRegistry(admin);
        fr = new FailRecord(admin);
        rr = new ReproRegistry(admin);
    }

    // ------------------------------------------------- AssuranceRegistry --

    function test_ar_onlyAdminMayRegister() public {
        vm.prank(stranger);
        vm.expectRevert(AssuranceRegistry.NotAdmin.selector);
        ar.registerProcedure(CODE, subject, bytes32(0), DAY, 0);
    }

    function test_ar_rejectsZeroSubject() public {
        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.ZeroAddress.selector);
        ar.registerProcedure(CODE, address(0), bytes32(0), DAY, 0);
    }

    function test_ar_setReporterGuards() public {
        vm.prank(admin);
        bytes32 id = ar.registerProcedure(CODE, subject, bytes32(0), DAY, 0);

        vm.prank(stranger);
        vm.expectRevert(AssuranceRegistry.NotAdmin.selector);
        ar.setReporter(id, other, true);

        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.ZeroAddress.selector);
        ar.setReporter(id, address(0), true);

        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.UnknownProcedure.selector);
        ar.setReporter(keccak256("nope"), other, true);
    }

    function test_ar_reporterCanBeRevoked() public {
        vm.prank(admin);
        bytes32 id = ar.registerProcedure(CODE, subject, bytes32(0), DAY, 0);
        vm.prank(admin);
        ar.setReporter(id, other, true);
        assertTrue(ar.isReporter(id, other));

        vm.prank(admin);
        ar.setReporter(id, other, false);
        assertFalse(ar.isReporter(id, other));

        vm.warp(block.timestamp + DAY);
        vm.prank(other);
        vm.expectRevert(AssuranceRegistry.NotReporter.selector);
        ar.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, bytes32(0), 0);
    }

    function test_ar_deactivateGuards() public {
        vm.prank(admin);
        bytes32 id = ar.registerProcedure(CODE, subject, bytes32(0), DAY, 0);

        vm.prank(stranger);
        vm.expectRevert(AssuranceRegistry.NotAdmin.selector);
        ar.deactivate(id);

        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.UnknownProcedure.selector);
        ar.deactivate(keccak256("nope"));

        vm.prank(admin);
        ar.deactivate(id);
        assertFalse(ar.procedureOf(id).active);
    }

    function test_ar_adminTransfer() public {
        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.ZeroAddress.selector);
        ar.transferAdmin(address(0));

        vm.prank(stranger);
        vm.expectRevert(AssuranceRegistry.NotAdmin.selector);
        ar.transferAdmin(other);

        vm.prank(admin);
        ar.transferAdmin(other);
        assertEq(ar.admin(), other);

        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.NotAdmin.selector);
        ar.transferAdmin(admin);
    }

    function test_ar_constructorRejectsZeroAdmin() public {
        vm.expectRevert(AssuranceRegistry.ZeroAddress.selector);
        new AssuranceRegistry(address(0));
    }

    function test_ar_lapseOnUnknownProcedureReverts() public {
        vm.expectRevert(AssuranceRegistry.UnknownProcedure.selector);
        ar.lapse(keccak256("nope"), 0);
    }

    function test_ar_concludeOnUnknownProcedureReverts() public {
        vm.expectRevert(AssuranceRegistry.UnknownProcedure.selector);
        ar.conclude(keccak256("nope"), 0, AssuranceRegistry.Opinion.CLEAN, bytes32(0), 0);
    }

    function test_ar_coverageOnUnknownProcedureReverts() public {
        vm.expectRevert(AssuranceRegistry.UnknownProcedure.selector);
        ar.coverage(keccak256("nope"), 0, 1);
    }

    function test_ar_procedureViewRoundTrips() public {
        vm.prank(admin);
        bytes32 id = ar.registerProcedure(CODE, subject, keccak256("m"), DAY, 99);
        AssuranceRegistry.Procedure memory p = ar.procedureOf(id);
        assertEq(p.codeHash, CODE);
        assertEq(p.subject, subject);
        assertEq(p.manifestHash, keccak256("m"));
        assertEq(p.periodLength, DAY);
        assertEq(p.graceSeconds, 99);
        assertTrue(p.active);
        assertEq(ar.currentPeriod(id), 0);
    }

    function test_ar_lastConcludedPeriodTracksTheHighest() public {
        vm.prank(admin);
        bytes32 id = ar.registerProcedure(CODE, subject, bytes32(0), DAY, 0);
        vm.warp(block.timestamp + 3 * DAY);

        vm.prank(admin);
        ar.conclude(id, 2, AssuranceRegistry.Opinion.CLEAN, bytes32(0), 0);
        assertEq(ar.lastConcludedPeriod(id), 2);

        // An older period arriving late must not move the high-water mark back.
        vm.prank(admin);
        ar.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, bytes32(0), 0);
        assertEq(ar.lastConcludedPeriod(id), 2);
    }

    // -------------------------------------------------------- FailRecord --

    function test_fr_adminTransferAndGuards() public {
        vm.prank(stranger);
        vm.expectRevert(FailRecord.NotAdmin.selector);
        fr.setAdjudicator(other, true);

        vm.prank(admin);
        vm.expectRevert(FailRecord.ZeroAddress.selector);
        fr.setAdjudicator(address(0), true);

        vm.prank(admin);
        vm.expectRevert(FailRecord.ZeroAddress.selector);
        fr.transferAdmin(address(0));

        vm.prank(stranger);
        vm.expectRevert(FailRecord.NotAdmin.selector);
        fr.transferAdmin(other);

        vm.prank(admin);
        fr.transferAdmin(other);
        assertEq(fr.admin(), other);
    }

    function test_fr_constructorRejectsZeroAdmin() public {
        vm.expectRevert(FailRecord.ZeroAddress.selector);
        new FailRecord(address(0));
    }

    function test_fr_defaultAtReturnsTheFullAdjudication() public {
        address src = address(0xAAAA);
        address obligor = address(0xBBBB);
        vm.prank(admin);
        fr.adjudicate(src, 7, FailRecord.Outcome.DEFAULTED, obligor, other, 42, 900_000, 1234);

        FailRecord.Adjudication memory a = fr.defaultAt(obligor, 0);
        assertEq(a.amount, 42);
        assertEq(a.roundId, 900_000);
        assertEq(a.deadline, 1234);
        assertEq(uint256(a.outcome), uint256(FailRecord.Outcome.DEFAULTED));
    }

    function test_fr_performedDoesNotEnterTheDefaultIndex() public {
        address src = address(0xAAAA);
        address obligor = address(0xBBBB);
        vm.prank(admin);
        fr.adjudicate(src, 1, FailRecord.Outcome.PERFORMED, obligor, other, 1, 1, 0);
        assertEq(fr.defaultCount(obligor), 0, "a settled obligation is not a default");
        assertEq(fr.totalDefaults(), 0);
        assertEq(fr.totalAdjudications(), 1);
    }

    // ----------------------------------------------------- ReproRegistry --

    function test_rr_unknownAssessmentViewsAreEmpty() public view {
        bytes32 unknown = keccak256("never");
        assertEq(rr.assessmentCount(unknown), 0);
        assertEq(rr.claimCount(unknown), 0);
    }

    function test_rr_adminMayNotBeZeroOnTransfer() public {
        vm.prank(admin);
        vm.expectRevert(ReproRegistry.ZeroAddress.selector);
        rr.transferAdmin(address(0));
    }

    function test_rr_nonAdminCannotTransfer() public {
        vm.prank(stranger);
        vm.expectRevert(ReproRegistry.NotAdmin.selector);
        rr.transferAdmin(other);
    }

    function test_rr_assessRejectsAnEmptyCodeHash() public {
        // The same guard exists on claimSource and was tested there, but an
        // assessment against bytes32(0) would attach a verdict to "no image at
        // all" — a row that reads as authoritative and means nothing.
        vm.prank(admin);
        vm.expectRevert(ReproRegistry.EmptyCodeHash.selector);
        rr.assess(bytes32(0), ReproRegistry.Verdict.SIMULATED, bytes32(0), "");
    }
}
