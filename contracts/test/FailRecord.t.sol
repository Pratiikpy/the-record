// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FailRecord} from "../src/FailRecord.sol";

contract FailRecordTest is Test {
    FailRecord internal rec;

    address internal admin = address(0xA11CE);
    address internal relay = address(0xB0B);
    address internal stranger = address(0xBEEF);

    /// AssetManagerFXRP on Coston2.
    address internal constant AM = 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA;
    address internal constant AGENT_A = address(0xA6E71);
    address internal constant AGENT_B = address(0xA6E72);
    address internal constant REDEEMER = address(0x5EED);

    function setUp() public {
        rec = new FailRecord(admin);
        vm.prank(admin);
        rec.setAdjudicator(relay, true);
    }

    function _adjudicate(uint256 id, FailRecord.Outcome o, address obligor, uint256 amount)
        internal
        returns (bytes32)
    {
        vm.prank(relay);
        return rec.adjudicate(AM, id, o, obligor, REDEEMER, amount, 908_441, uint64(block.timestamp));
    }

    // ------------------------------------------------------------- writing --

    function test_onlyAdjudicatorMayWrite() public {
        vm.prank(stranger);
        vm.expectRevert(FailRecord.NotAdjudicator.selector);
        rec.adjudicate(AM, 1, FailRecord.Outcome.DEFAULTED, AGENT_A, REDEEMER, 1e18, 1, 0);
    }

    function test_refusesAVerdictWithNoCitation() public {
        // A verdict a reader cannot re-derive is worthless.
        vm.prank(relay);
        vm.expectRevert(FailRecord.CitationRequired.selector);
        rec.adjudicate(AM, 1, FailRecord.Outcome.DEFAULTED, AGENT_A, REDEEMER, 1e18, 0, 0);
    }

    function test_refusesTheEmptyOutcome() public {
        vm.prank(relay);
        vm.expectRevert(FailRecord.OutcomeRequired.selector);
        rec.adjudicate(AM, 1, FailRecord.Outcome.NONE, AGENT_A, REDEEMER, 1e18, 1, 0);
    }

    function test_refusesAZeroObligor() public {
        vm.prank(relay);
        vm.expectRevert(FailRecord.ZeroAddress.selector);
        rec.adjudicate(AM, 1, FailRecord.Outcome.DEFAULTED, address(0), REDEEMER, 1e18, 1, 0);
    }

    function test_anObligationIsAdjudicatedOnlyOnce() public {
        _adjudicate(1, FailRecord.Outcome.DEFAULTED, AGENT_A, 42_000e6);

        vm.prank(relay);
        vm.expectRevert(FailRecord.AlreadyAdjudicated.selector);
        rec.adjudicate(AM, 1, FailRecord.Outcome.PERFORMED, AGENT_A, REDEEMER, 1, 2, 0);
    }

    function test_recordsPerformanceAsWellAsDefault() public {
        // Without a denominator, a fail rate is not evidence.
        _adjudicate(1, FailRecord.Outcome.PERFORMED, AGENT_A, 1e6);
        _adjudicate(2, FailRecord.Outcome.PERFORMED, AGENT_A, 1e6);
        _adjudicate(3, FailRecord.Outcome.DEFAULTED, AGENT_A, 5e6);

        FailRecord.Standing memory s = rec.standingOf(AGENT_A);
        assertEq(s.performed, 2);
        assertEq(s.defaulted, 1);
        assertEq(s.valueDefaulted, 5e6);

        (uint256 bps, uint256 total) = rec.failRateBps(AGENT_A);
        assertEq(total, 3);
        assertEq(bps, 3_333); // 1/3 in basis points, truncated
    }

    // --------------------------------------------------------------- keys --

    function test_keysAreNamespacedBySource() public {
        address otherManager = address(0xDEAD);
        _adjudicate(7, FailRecord.Outcome.DEFAULTED, AGENT_A, 1e6);

        // Same numeric id on a different asset manager must not collide.
        vm.prank(relay);
        rec.adjudicate(otherManager, 7, FailRecord.Outcome.PERFORMED, AGENT_B, REDEEMER, 1e6, 5, 0);

        assertEq(uint256(rec.adjudicationOf(AM, 7).outcome), uint256(FailRecord.Outcome.DEFAULTED));
        assertEq(
            uint256(rec.adjudicationOf(otherManager, 7).outcome),
            uint256(FailRecord.Outcome.PERFORMED)
        );
    }

    function testFuzz_obligationKeyIsInjective(
        address s1,
        uint256 i1,
        address s2,
        uint256 i2
    ) public view {
        vm.assume(s1 != s2 || i1 != i2);
        assertTrue(rec.obligationKey(s1, i1) != rec.obligationKey(s2, i2));
    }

    // ------------------------------------------------- the unknown-vs-clean --

    function test_unknownObligorIsNotACleanRecord() public view {
        // The most dangerous misreading of this contract: 0 bps for an obligor
        // nobody has ever adjudicated. `total` is the guard, and it is 0.
        (uint256 bps, uint256 total) = rec.failRateBps(AGENT_B);
        assertEq(bps, 0);
        assertEq(total, 0, "callers must treat total==0 as UNKNOWN, never as clean");

        FailRecord.Standing memory s = rec.standingOf(AGENT_B);
        assertEq(s.performed, 0);
        assertEq(s.defaulted, 0);
    }

    function test_aCleanRecordHasANonZeroDenominator() public {
        _adjudicate(1, FailRecord.Outcome.PERFORMED, AGENT_B, 1e6);
        (uint256 bps, uint256 total) = rec.failRateBps(AGENT_B);
        assertEq(bps, 0);
        assertEq(total, 1, "this is what a genuinely clean record looks like");
    }

    // ------------------------------------------------------------ indexing --

    function test_defaultsAreEnumerablePerObligor() public {
        _adjudicate(1, FailRecord.Outcome.DEFAULTED, AGENT_A, 10e6);
        _adjudicate(2, FailRecord.Outcome.PERFORMED, AGENT_A, 1e6);
        _adjudicate(3, FailRecord.Outcome.DEFAULTED, AGENT_A, 20e6);
        _adjudicate(4, FailRecord.Outcome.DEFAULTED, AGENT_B, 5e6);

        assertEq(rec.defaultCount(AGENT_A), 2);
        assertEq(rec.defaultCount(AGENT_B), 1);
        assertEq(rec.defaultAt(AGENT_A, 0).amount, 10e6);
        assertEq(rec.defaultAt(AGENT_A, 1).amount, 20e6);

        assertEq(rec.totalAdjudications(), 4);
        assertEq(rec.totalDefaults(), 3);
    }

    function test_citationSurvivesOnTheRecord() public {
        _adjudicate(1, FailRecord.Outcome.DEFAULTED, AGENT_A, 42_000e6);
        FailRecord.Adjudication memory a = rec.adjudicationOf(AM, 1);
        assertEq(a.roundId, 908_441);
        assertEq(a.obligor, AGENT_A);
        assertEq(a.obligee, REDEEMER);
        assertGt(a.adjudicatedAt, 0);
    }

    // -------------------------------------------------------------- admin --

    function test_adminCanRevokeAnAdjudicator() public {
        vm.prank(admin);
        rec.setAdjudicator(relay, false);

        vm.prank(relay);
        vm.expectRevert(FailRecord.NotAdjudicator.selector);
        rec.adjudicate(AM, 1, FailRecord.Outcome.DEFAULTED, AGENT_A, REDEEMER, 1, 1, 0);
    }

    function testFuzz_valueDefaultedAccumulatesExactly(uint128 a, uint128 b) public {
        _adjudicate(1, FailRecord.Outcome.DEFAULTED, AGENT_A, a);
        _adjudicate(2, FailRecord.Outcome.DEFAULTED, AGENT_A, b);
        assertEq(rec.standingOf(AGENT_A).valueDefaulted, uint256(a) + uint256(b));
    }
}
