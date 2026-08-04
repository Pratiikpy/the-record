// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AssuranceRegistry} from "../src/AssuranceRegistry.sol";

contract AssuranceRegistryTest is Test {
    AssuranceRegistry internal reg;

    address internal admin = address(0xA11CE);
    address internal reporter = address(0xB0B);
    address internal anyone = address(0xBEEF);
    address internal subject = address(0x5AFE);

    bytes32 internal constant CODE_HASH = keccak256("cv-1-image");
    bytes32 internal constant MANIFEST = keccak256("manifest");
    uint64 internal constant DAY = 1 days;
    uint64 internal constant GRACE = 6 hours;

    bytes32 internal id;

    function setUp() public {
        vm.warp(1_000_000);
        reg = new AssuranceRegistry(admin);
        vm.prank(admin);
        id = reg.registerProcedure(CODE_HASH, subject, MANIFEST, DAY, GRACE);
        vm.prank(admin);
        reg.setReporter(id, reporter, true);
    }

    // ---------------------------------------------------------- registry --

    function test_procedureIdIsDerivedFromCodeHashAndSubject() public view {
        assertEq(id, reg.procedureId(CODE_HASH, subject));
        assertTrue(id != reg.procedureId(CODE_HASH, address(0x1234)));
    }

    function test_cannotRegisterTheSameProcedureTwice() public {
        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.ProcedureExists.selector);
        reg.registerProcedure(CODE_HASH, subject, MANIFEST, DAY, GRACE);
    }

    function test_rejectsAZeroPeriodLength() public {
        vm.prank(admin);
        vm.expectRevert(AssuranceRegistry.InvalidPeriodLength.selector);
        reg.registerProcedure(keccak256("x"), subject, MANIFEST, 0, GRACE);
    }

    function test_unknownProcedureReverts() public {
        vm.expectRevert(AssuranceRegistry.UnknownProcedure.selector);
        reg.currentPeriod(keccak256("nope"));
    }

    // -------------------------------------------------- one path for all --

    function test_cleanAndExceptionTravelTheSamePath() public {
        vm.warp(block.timestamp + 2 * DAY);

        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, keccak256("e0"), 0);
        vm.prank(reporter);
        reg.conclude(id, 1, AssuranceRegistry.Opinion.EXCEPTION, keccak256("e1"), 3);

        assertEq(uint256(reg.conclusionOf(id, 0).opinion), uint256(AssuranceRegistry.Opinion.CLEAN));
        assertEq(uint256(reg.conclusionOf(id, 1).opinion), uint256(AssuranceRegistry.Opinion.EXCEPTION));
        assertEq(reg.conclusionOf(id, 1).exceptionCount, 3);
        // Same storage, same function — there is no happy route to lean on.
        assertEq(reg.conclusionOf(id, 0).reporter, reg.conclusionOf(id, 1).reporter);
    }

    function test_disclaimerIsARecordableConclusion() public {
        vm.warp(block.timestamp + DAY);
        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.DISCLAIMER, keccak256("e"), 0);
        assertEq(uint256(reg.conclusionOf(id, 0).opinion), uint256(AssuranceRegistry.Opinion.DISCLAIMER));
    }

    function test_reporterMayNotAssertNoneOrLapsed() public {
        // Both are outcomes the registry derives; letting a reporter write
        // LAPSED would let a subject pre-empt its own adverse record.
        vm.warp(block.timestamp + DAY);
        vm.prank(reporter);
        vm.expectRevert(AssuranceRegistry.InvalidOpinion.selector);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.NONE, bytes32(0), 0);

        vm.prank(reporter);
        vm.expectRevert(AssuranceRegistry.InvalidOpinion.selector);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.LAPSED, bytes32(0), 0);
    }

    function test_onlyAReporterMayConclude() public {
        vm.warp(block.timestamp + DAY);
        vm.prank(anyone);
        vm.expectRevert(AssuranceRegistry.NotReporter.selector);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, bytes32(0), 0);
    }

    function test_aPeriodIsConcludedOnlyOnce() public {
        vm.warp(block.timestamp + DAY);
        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.EXCEPTION, keccak256("bad"), 1);

        vm.prank(reporter);
        vm.expectRevert(AssuranceRegistry.AlreadyConcluded.selector);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, keccak256("nice"), 0);
    }

    function test_cannotConcludeAPeriodThatHasNotStarted() public {
        vm.prank(reporter);
        vm.expectRevert(AssuranceRegistry.PeriodNotStarted.selector);
        reg.conclude(id, 5, AssuranceRegistry.Opinion.CLEAN, bytes32(0), 0);
    }

    // ------------------------------------------------------------ lapse --

    function test_anyoneMayLapseAnOverduePeriod() public {
        // Period 0 ends at start+DAY, grace to start+DAY+GRACE.
        vm.warp(block.timestamp + DAY + GRACE + 1);
        vm.prank(anyone);
        reg.lapse(id, 0);
        assertEq(uint256(reg.conclusionOf(id, 0).opinion), uint256(AssuranceRegistry.Opinion.LAPSED));
        assertEq(reg.conclusionOf(id, 0).reporter, anyone);
    }

    function test_cannotLapseWhileStillInGrace() public {
        vm.warp(block.timestamp + DAY + GRACE - 1);
        vm.expectRevert(AssuranceRegistry.PeriodNotExpired.selector);
        reg.lapse(id, 0);
    }

    function test_cannotLapseAPeriodThatConcluded() public {
        vm.warp(block.timestamp + DAY);
        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, keccak256("e"), 0);

        vm.warp(block.timestamp + DAY + GRACE + 1);
        vm.expectRevert(AssuranceRegistry.AlreadyConcluded.selector);
        reg.lapse(id, 0);
    }

    function test_suppressionBecomesTheRecord() public {
        // The attack this design exists to answer: a subject dislikes the
        // conclusion and simply never relays it. It cannot manufacture a clean
        // period, and after grace ANYONE writes the adverse record.
        vm.warp(block.timestamp + 3 * DAY + GRACE + 1);

        vm.prank(anyone);
        reg.lapse(id, 0);
        vm.prank(anyone);
        reg.lapse(id, 1);

        (uint64 concluded, uint64 clean, uint64 adverse,) = reg.coverage(id, 0, 1);
        assertEq(concluded, 2);
        assertEq(clean, 0);
        assertEq(adverse, 2, "a withheld period must count as adverse, never as clean");
    }

    // --------------------------------------------------------- coverage --

    function test_coverageSeparatesMissingFromClean() public {
        vm.warp(block.timestamp + 3 * DAY);
        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.CLEAN, keccak256("a"), 0);
        vm.prank(reporter);
        reg.conclude(id, 2, AssuranceRegistry.Opinion.EXCEPTION, keccak256("c"), 2);

        (uint64 concluded, uint64 clean, uint64 adverse, uint64 missing) = reg.coverage(id, 0, 2);
        assertEq(concluded, 2);
        assertEq(clean, 1);
        assertEq(adverse, 1);
        assertEq(missing, 1, "period 1 is missing, which is not the same as clean");
    }

    function test_disclaimerCountsAsAdverseNotClean() public {
        vm.warp(block.timestamp + DAY);
        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion.DISCLAIMER, keccak256("d"), 0);

        (, uint64 clean, uint64 adverse,) = reg.coverage(id, 0, 0);
        assertEq(clean, 0);
        assertEq(adverse, 1, "insufficient evidence must never roll up as clean");
    }

    function test_unreportedProcedureReadsAsMissingNotClean() public view {
        (uint64 concluded, uint64 clean, uint64 adverse, uint64 missing) = reg.coverage(id, 0, 4);
        assertEq(concluded, 0);
        assertEq(clean, 0);
        assertEq(adverse, 0);
        assertEq(missing, 5, "callers must read concluded==0 as UNKNOWN");
    }

    // ------------------------------------------------------------- fuzz --

    function testFuzz_lapseIsNeverPossibleBeforeTheDeadline(uint32 skipSeconds) public {
        uint256 deadline = uint256(DAY) + GRACE;
        vm.assume(skipSeconds <= deadline);
        vm.warp(block.timestamp + skipSeconds);
        vm.expectRevert(AssuranceRegistry.PeriodNotExpired.selector);
        reg.lapse(id, 0);
    }

    function testFuzz_concludedPeriodsAlwaysReadBackIdentically(
        uint8 rawOpinion,
        bytes32 digest,
        uint32 count
    ) public {
        // 1..3 = CLEAN, EXCEPTION, DISCLAIMER
        uint8 o = uint8(bound(rawOpinion, 1, 3));
        vm.warp(block.timestamp + DAY);
        vm.prank(reporter);
        reg.conclude(id, 0, AssuranceRegistry.Opinion(o), digest, count);

        AssuranceRegistry.Conclusion memory c = reg.conclusionOf(id, 0);
        assertEq(uint256(c.opinion), o);
        assertEq(c.evidenceDigest, digest);
        assertEq(c.exceptionCount, count);
    }
}
