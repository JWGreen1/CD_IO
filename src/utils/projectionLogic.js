// src/utils/projectionLogic.js
import { addMonths, startOfYear, parseISO } from 'date-fns'; // Use parseISO, removed unused imports

// --- Helper Functions ---
function parseDateString(dateString) {
    // Use parseISO for YYYY-MM-DD robustness
    if (!dateString || typeof dateString !== 'string') return null;
    try {
        const date = parseISO(dateString);
        // Check if the parsed date is valid (handles invalid formats like 'YYYY-MM-DDTHH:MM:SS' without Z)
        if (isNaN(date.getTime())) {
             console.warn(`Invalid date format encountered: ${dateString}`);
             return null;
        }
        return date;
    } catch (e) {
        console.error("Error parsing date:", dateString, e);
        return null;
    }
}

// Helper to generate unique IDs for reinvested tranches
let reinvestmentCounter = 0;
const generateReinvestId = (originalId) => `${originalId}-reinvest-${reinvestmentCounter++}`;

// Simple formatCurrency helper (used in warnings)
function formatCurrency(value) {
    // Handle potential non-numeric values gracefully
    const numValue = Number(value);
     if (isNaN(numValue)) { return '$?.??'; } // Placeholder for NaN
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numValue);
}

// --- START: Rate Scenario Logic ---

// Holds target APYs and timing for scenarios
// Note: These rules are applied based on the *start* year of the calculation period.
// Example: targetYearStartEffect: 2 means the effect starts applying to rates used *for* year 2 (when yearsElapsed = 1).
const RATE_SCENARIOS = {
    ratesStayHigh: { // Baseline - uses provided interestRates directly
        label: "Rates Stay High (Baseline)",
        description: "Assumes current rates persist indefinitely.",
    },
    ratesFallModerately: {
        label: "Rates Fall Moderately",
        description: "Assumes HYSA rates drop 0.5% and new CD yields drop 0.75% after Year 1, repeating in Year 3.",
        targetYearStartEffect: 2, // Starts affecting calculations *for* Year 2 (yearsElapsed = 1)
        targetYearFullEffect: 3, // Fully adjusted by start of Year 3 (yearsElapsed = 2)
        floor: 0.25, // Minimum APY%
        // Define target rates relative to baseline (example adjustments)
        adjustments: { HYSA: -0.5, '6m': -0.75, '9m': -0.75, '12m': -0.75, '18m': -0.75, '24m': -0.75, '30m': -0.75, '36m': -0.75, '48m': -0.75, '60m': -0.75 }
    },
    ratesFallSignificantly: {
        label: "Rates Fall Significantly",
        description: "A more aggressive drop in rates after Year 1 and Year 3.",
        targetYearStartEffect: 1, // Starts affecting calculations *for* Year 1 (yearsElapsed = 0) -> affects Year 2 rates
        targetYearFullEffect: 2, // Fully adjusted by start of Year 2 (yearsElapsed = 1)
        floor: 0.10, // Minimum APY%
        // Define target rates relative to baseline (example adjustments)
        adjustments: { HYSA: -1.5, '6m': -2.0, '9m': -2.0, '12m': -2.0, '18m': -2.0, '24m': -2.0, '30m': -2.0, '36m': -2.0, '48m': -2.0, '60m': -2.0 }
    }
};

/**
 * Gets the applicable APY for a given term in a specific year under a scenario.
 * Returns APY as percentage points (e.g., 3.5).
 */
function getRateForYear(termKey, year, scenarioKey, baseRates, startYear) {
    const baseRateInfo = baseRates[termKey];
    if (!baseRateInfo || typeof baseRateInfo.apy !== 'number') {
        console.warn(`Missing or invalid base rate for term ${termKey}. Returning 0.`);
        return 0;
    }
    const baseApy = baseRateInfo.apy;

    // Handle baseline scenario directly
    if (scenarioKey === 'ratesStayHigh' || !scenarioKey) {
        return baseApy;
    }

    const scenarioConfig = RATE_SCENARIOS[scenarioKey];
    if (!scenarioConfig || scenarioKey === 'ratesStayHigh') { // Double check if config exists
        console.warn(`Unknown or baseline scenario: ${scenarioKey}. Using baseline rates.`);
        return baseApy;
    }

    // Calculate target APY based on adjustments
    const adjustment = scenarioConfig.adjustments[termKey] ?? scenarioConfig.adjustments['HYSA'] ?? 0; // Fallback adjustment logic
    const targetApy = baseApy + adjustment;
    const floor = scenarioConfig.floor;
    const yearsElapsed = year - startYear; // How many full years have passed *before* this one starts

    let currentApy = baseApy; // Start with baseline

    // Apply scenario adjustments based on timing (linear interpolation)
    const startEffectElapsed = scenarioConfig.targetYearStartEffect - 1; // e.g., targetYear 2 means start effect when yearsElapsed = 1
    const fullEffectElapsed = scenarioConfig.targetYearFullEffect - 1; // e.g., targetYear 3 means full effect when yearsElapsed = 2
    const adjustmentDuration = fullEffectElapsed - startEffectElapsed;

    if (yearsElapsed >= fullEffectElapsed) { // Fully adjusted
         currentApy = targetApy;
    } else if (yearsElapsed >= startEffectElapsed && adjustmentDuration > 0) { // Partially adjusted (linear interpolation)
         // Progress: how far through the adjustment period are we? (Starts at 1/duration, ends at duration/duration)
         const progress = (yearsElapsed - startEffectElapsed + 1) / (adjustmentDuration + 1);
         currentApy = baseApy + (targetApy - baseApy) * progress;
    }
    // else: Before adjustment starts, currentApy remains baseApy

    return Math.max(floor, currentApy); // Apply floor
}

// --- END: Rate Scenario Logic ---


export function calculateProjections({
    investmentStartDate,
    lumpSum,
    taxRate,
    tranches,
    withdrawals,
    interestRates, // Base rates
    rateScenario = 'ratesStayHigh' // Add new parameter with default
}) {
    const projection = [];
    let cashBalance = 0; // Cash balance at the START of the year
    let totalInterestEarnedCumulative = 0; // Cumulative total interest over all years
    let totalTaxesPaidCumulative = 0;    // Cumulative total taxes over all years
    let hasShortfallOverall = false;      // Overall flag if any year ended with a shortfall
    let cumulativeShortfall = 0; // Tracks shortfall carried over from previous years

    // --- Input Validation ---
    // Ensure core inputs are present and valid numbers where expected
    if (!investmentStartDate || lumpSum === undefined || lumpSum === null || isNaN(Number(lumpSum)) ||
        taxRate === undefined || taxRate === null || isNaN(Number(taxRate)) ||
        !tranches || !withdrawals || !interestRates) {
        console.error("Missing required input or invalid number format for calculation");
        return { projectionYears: [], hasShortfall: false, totals: {}, error: "Missing or invalid required inputs (Date, Lump Sum, Tax Rate)" };
    }
    const parsedStart = parseDateString(investmentStartDate);
    if (!parsedStart || isNaN(parsedStart.getFullYear())) {
         console.error("Invalid Investment Start Date:", investmentStartDate);
         return { projectionYears: [], hasShortfall: false, totals: {}, error: "Invalid Investment Start Date" };
    }
    const startYear = parsedStart.getFullYear();
    const startMonth = parsedStart.getMonth(); // 0-indexed

    // Convert lumpSum and taxRate to numbers for internal use
    const numLumpSum = Number(lumpSum);
    const numTaxRate = Number(taxRate) / 100; // Use as decimal internally

    // --- Initial Tranche Data Processing ---
    const allocatedSum = tranches.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    if (Math.abs(allocatedSum - numLumpSum) > 0.01) {
        console.warn(`Warning: Allocated tranche amounts (${formatCurrency(allocatedSum)}) do not match Lump Sum (${formatCurrency(numLumpSum)})`);
        // This is a warning, calculation continues based on allocated amounts
    }

    // Process initial tranches, adding necessary info and ensuring amounts are numbers
    const initialTranches = tranches.map((tranche, index) => {
        const termKey = tranche.term;
        const rateInfo = interestRates[termKey];
        // Validate rate info exists
        if (!rateInfo || typeof rateInfo.apy !== 'number') {
             throw new Error(`Missing or invalid rate data for term: ${termKey}`);
        }
        const apy = rateInfo.apy / 100;
        const trancheId = tranche.id || `${termKey}-${index}`;
        const principal = Number(tranche.amount) || 0; // Ensure amount is a number

        if (termKey === 'HYSA') {
            return {
                ...tranche, id: trancheId,
                amount: principal, // Use validated principal
                maturityDate: null,
                interestEarned: 0, valueAtMaturity: principal,
                isHYSA: true
            };
        } else {
            // Validate CD duration
            const termMonths = rateInfo.duration;
            if (typeof termMonths !== 'number' || termMonths <= 0) {
                throw new Error(`Invalid duration for term: ${termKey}`);
            }
            const maturityDate = addMonths(parsedStart, termMonths);
            const termYears = termMonths / 12;
            const valueAtMaturity = principal * Math.pow(1 + apy, termYears);
            const interestEarned = valueAtMaturity - principal;
            return {
                ...tranche, id: trancheId,
                amount: principal, // Use validated principal
                termMonths,
                maturityDate, interestEarned, valueAtMaturity,
                isHYSA: false,
                // Ensure reinvestment options are present with defaults
                reinvestmentOption: tranche.reinvestmentOption || 'cash',
                reinvestmentTerm: tranche.reinvestmentTerm || '12m' // Default reinvest term if needed
             };
        }
    });

    // --- Determine Projection Year Range ---
    const allYears = new Set();
    allYears.add(startYear);
    withdrawals.forEach(w => {
        const withdrawalDate = parseDateString(w.date);
        if (withdrawalDate && !isNaN(withdrawalDate.getFullYear())) {
             allYears.add(withdrawalDate.getFullYear());
        } else { console.warn(`Invalid or missing withdrawal date: ${w.date}`); }
    });
    initialTranches.forEach(t => {
        if (t.maturityDate && !isNaN(t.maturityDate.getFullYear())) {
            allYears.add(t.maturityDate.getFullYear());
        }
    });

    // Handle edge case where no valid dates result in years
    if (allYears.size === 0) {
        console.warn("No valid years found for projection.");
        return { projectionYears: [], hasShortfall: false, totals: {} };
    }

    const minYear = Math.min(...allYears);
    // Estimate max year needed based on initial terms + buffer for reinvestment
    const maxInitialTerm = Math.max(0, ...initialTranches.filter(t => !t.isHYSA).map(t => t.termMonths || 0));
    const maxKnownEventYear = Math.max(...allYears);
    // Add a reasonable buffer (e.g., 5 years) beyond last known event or longest initial term maturity
    const maxYear = Math.max(maxKnownEventYear, startYear + Math.ceil(maxInitialTerm / 12) + 5);
    const yearRange = [];
    for (let y = minYear; y <= maxYear; y++) { yearRange.push(y); }


    // --- Initialize Balances & Active Tranches ---
    const hysaTranches = initialTranches.filter(t => t.isHYSA);
    const initialHysaBalance = hysaTranches.reduce((sum, t) => sum + t.amount, 0);
    let currentHysaBalance = initialHysaBalance; // Balance at the START of the year
    let activeCdTranches = initialTranches.filter(t => !t.isHYSA); // Dynamic list of active CDs


    // --- Yearly Projection Loop ---
    for (const year of yearRange) {
        // Use UTC date for start of year to avoid timezone issues in calculations
        const currentYearStart = new Date(Date.UTC(year, 0, 1));

        // Apply shortfall from previous year BEFORE processing this year's income/expenses
        let startingCashForYear = cashBalance - cumulativeShortfall; // Effective cash start after covering prior shortfall

        // --- Process Maturing CDs & Reinvestment ---
        let maturingValueTotalThisYear = 0; // Total value (principal + interest) of CDs maturing THIS year
        let interestFromMaturingCDsThisYear = 0;
        let cashFromMaturingThisYear = 0; // Amount from maturing CDs going DIRECTLY to cash THIS year
        let newlyReinvestedTranches = []; // Stores NEW CD tranches created via reinvestment THIS year
        let hysaValueReinvestedThisYear = 0; // Amount from maturing CDs reinvested into HYSA THIS year
        const remainingCdTranches = []; // CDs NOT maturing this year

        for (const cd of activeCdTranches) {
            // Check if the maturity date is valid and falls within the current projection year
            if (cd.maturityDate && !isNaN(cd.maturityDate.getFullYear()) && cd.maturityDate.getFullYear() === year) {
                // CD matures this year
                maturingValueTotalThisYear += cd.valueAtMaturity;
                interestFromMaturingCDsThisYear += cd.interestEarned;

                // Accumulate total interest earned globally
                totalInterestEarnedCumulative += cd.interestEarned;

                // Handle Reinvestment Choice - Check for existing shortfall FIRST
                if (cumulativeShortfall > 0.01) {
                    // If there's a carry-over shortfall, force maturing funds to cash to cover it
                    cashFromMaturingThisYear += cd.valueAtMaturity;
                    console.warn(`Tranche ${cd.id}: Reinvestment blocked due to existing shortfall (${formatCurrency(cumulativeShortfall)}). Holding as cash.`);
                } else {
                    // No shortfall, proceed with chosen reinvestment option
                    switch (cd.reinvestmentOption) {
                        case 'hysa':
                            // Only add to HYSA balance if an HYSA tranche was initially defined
                            if (hysaTranches.length > 0) {
                                 // This value is added to HYSA balance LATER (after interest calc)
                                 hysaValueReinvestedThisYear += cd.valueAtMaturity;
                            } else {
                                cashFromMaturingThisYear += cd.valueAtMaturity; // Fallback to cash
                                console.warn(`Tranche ${cd.id}: Reinvest to HYSA failed (no HYSA defined). Holding as cash.`);
                            }
                            break;

                        case 'newCD':
                            const reinvestTermKey = cd.reinvestmentTerm;
                            const rateInfo = interestRates[reinvestTermKey];
                            // Validate reinvestment rate/duration info
                            if (!rateInfo || typeof rateInfo.apy !== 'number' || typeof rateInfo.duration !== 'number' || rateInfo.duration <= 0) {
                                cashFromMaturingThisYear += cd.valueAtMaturity; // Fallback to cash
                                console.warn(`Tranche ${cd.id}: Invalid rate/duration for reinvestment term ${reinvestTermKey}. Holding as cash.`);
                                break;
                            }

                            // --- Use Scenario Rate for New CD ---
                            const newApyPercent = getRateForYear(reinvestTermKey, year, rateScenario, interestRates, startYear);
                            const newApy = newApyPercent / 100;
                            // --- --- ---

                            // Get duration from base rates (duration doesn't change with scenario)
                            if (!rateInfo || typeof rateInfo.duration !== 'number' || rateInfo.duration <= 0) {
                                cashFromMaturingThisYear += cd.valueAtMaturity; // Fallback to cash if duration invalid
                                console.warn(`Tranche ${cd.id}: Invalid duration info for reinvestment term ${reinvestTermKey}. Holding as cash.`);
                                break;
                            }

                            const newPrincipal = cd.valueAtMaturity;
                            const newTermMonths = rateInfo.duration;
                            // Start date for the new CD is the maturity date of the old one
                            const newStartDate = cd.maturityDate;
                            const newMaturityDate = addMonths(newStartDate, newTermMonths);
                            const newTermYears = newTermMonths / 12;
                            // Recalculate value/interest based on the SCENARIO APY
                            const newValueAtMaturity = newPrincipal * Math.pow(1 + newApy, newTermYears);
                            const newInterestEarned = newValueAtMaturity - newPrincipal;

                            const newTranche = {
                               // Set defaults for the new tranche - does not inherit previous reinvest settings
                               id: generateReinvestId(cd.id), // New unique ID
                               amount: newPrincipal,
                               term: reinvestTermKey,
                               termMonths: newTermMonths,
                               maturityDate: newMaturityDate,
                               interestEarned: newInterestEarned, // Interest for the *new* term
                               valueAtMaturity: newValueAtMaturity, // Value at *new* maturity
                               isHYSA: false,
                               reinvestmentOption: 'cash', // Default reinvest for this new CD
                               reinvestmentTerm: '12m'   // Default reinvest term
                            };
                            newlyReinvestedTranches.push(newTranche);

                            // Optional: Warn if new maturity extends beyond planned projection
                            if (newMaturityDate.getFullYear() > maxYear) {
                                 console.warn(`Reinvested tranche ${newTranche.id} matures (${newMaturityDate.getFullYear()}) beyond current projection range (${maxYear}).`);
                            }
                            break;

                        case 'cash':
                        default:
                            cashFromMaturingThisYear += cd.valueAtMaturity; // Add full value to cash pot
                            break;
                    }
                } // End else block for reinvestment choice
            } else {
                 // CD not maturing this year, keep it in the active list for next iteration
                 remainingCdTranches.push(cd);
            }
        }
        // Update the list of active CDs for the start of the *next* year's loop
        activeCdTranches = [...remainingCdTranches, ...newlyReinvestedTranches];

        // --- Calculate HYSA Interest ---
        // Interest is calculated based on the balance *at the start* of this year
        let hysaInterestThisYear = 0;
        const hysaRateInfo = interestRates['HYSA'];
        let hysaBalanceForInterestCalc = currentHysaBalance; // Use balance carried INTO the year

        // Check if HYSA exists (based on initial tranches) and has balance
        if (hysaTranches.length > 0 && hysaBalanceForInterestCalc > 0) {
             // --- Use Scenario Rate for HYSA ---
             const currentHysaApyPercent = getRateForYear('HYSA', year, rateScenario, interestRates, startYear);
             const annualRate = currentHysaApyPercent / 100;
             // --- --- ---

            let interestFactor = 1.0; // Default to full year
            if (year === startYear) { // Adjust for first partial year
                const monthsActive = 12 - startMonth;
                interestFactor = monthsActive / 12;
            }
            hysaInterestThisYear = hysaBalanceForInterestCalc * annualRate * interestFactor;
            totalInterestEarnedCumulative += hysaInterestThisYear; // Accumulate total interest
        }

        // --- Add Maturing CD value intended for HYSA to balance ---
        // This happens *after* interest calculation for the year
        currentHysaBalance += hysaValueReinvestedThisYear;


        // --- Calculate Taxes & Withdrawals ---
        const totalYearlyInterest = interestFromMaturingCDsThisYear + hysaInterestThisYear;
        const taxesDueThisYear = totalYearlyInterest * numTaxRate; // Use decimal tax rate
        totalTaxesPaidCumulative += taxesDueThisYear; // Accumulate total taxes

        const yearWithdrawals = withdrawals.filter(w => {
             const withdrawalDate = parseDateString(w.date);
             // Ensure date is valid before comparing year
             return withdrawalDate && !isNaN(withdrawalDate.getFullYear()) && withdrawalDate.getFullYear() === year;
        });
        const totalWithdrawalsThisYear = yearWithdrawals.reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

        // --- Cash Flow Calculation ---
        // Cash available = Starting cash (adjusted for prior shortfall) + Explicit cash from maturing CDs + HYSA interest earned this year
        let cashAvailableThisYear = startingCashForYear + cashFromMaturingThisYear + hysaInterestThisYear;

        // Calculate net cash flow before potentially using HYSA funds for shortfall
        let netCashFlowBeforeHysaTransfer = cashAvailableThisYear - totalWithdrawalsThisYear - taxesDueThisYear;

        // --- Shortfall Check & HYSA Usage ---
        let shortfallAmountThisYear = 0; // Tracks the shortfall *for this year*
        if (netCashFlowBeforeHysaTransfer < 0) {
            shortfallAmountThisYear = Math.abs(netCashFlowBeforeHysaTransfer);
        }

        let hysaWithdrawalToCoverShortfall = 0;
        // Check if HYSA has balance *before* attempting withdrawal
        if (shortfallAmountThisYear > 0 && currentHysaBalance > 0) {
            // Can only withdraw up to the available HYSA balance
            hysaWithdrawalToCoverShortfall = Math.min(shortfallAmountThisYear, currentHysaBalance);

            currentHysaBalance -= hysaWithdrawalToCoverShortfall; // Reduce HYSA balance immediately
            netCashFlowBeforeHysaTransfer += hysaWithdrawalToCoverShortfall; // Adjust cash flow number
            shortfallAmountThisYear -= hysaWithdrawalToCoverShortfall; // Reduce remaining shortfall *for this year*
        }

        // Final cash balance for the year end
        const endOfYearCash = Math.max(0, netCashFlowBeforeHysaTransfer); // Cash cannot be negative

        // Determine if the year *ended* with an uncovered shortfall
        const yearEndedWithShortfall = shortfallAmountThisYear > 0.01; // Use tolerance for float comparison
        if (yearEndedWithShortfall) {
             hasShortfallOverall = true; // Set the overall flag if any year has true shortfall
        }

        // --- Calculate End of Year Portfolio Values ---
        // Sum principal of CDs that are still active *after* this year
        const ongoingCDsPrincipal = activeCdTranches
            // Ensure maturity date exists and is in the future relative to the current year
            .filter(t => t.maturityDate && !isNaN(t.maturityDate.getFullYear()) && t.maturityDate.getFullYear() > year)
            .reduce((sum, t) => sum + t.amount, 0);

        // Total principal still invested (CDs + HYSA)
        const ongoingInvestmentsPrincipal = ongoingCDsPrincipal + currentHysaBalance;
        // Total portfolio value = Principal still invested + End-of-year cash
        const totalPortfolioValueEndOfYear = ongoingInvestmentsPrincipal + endOfYearCash;

        // --- Push Projection Data for the Year ---
        projection.push({
            year: year,
            maturingValue: maturingValueTotalThisYear, // Total value (P+I) of CDs maturing
            reinvestedValue: hysaValueReinvestedThisYear + newlyReinvestedTranches.reduce((sum, t) => sum + t.amount, 0), // Total value put back (HYSA or New CD)
            yearlyInterest: totalYearlyInterest,
            interestFromCDs: interestFromMaturingCDsThisYear,
            interestFromHYSA: hysaInterestThisYear,
            taxesDue: taxesDueThisYear,
            cashAvailableStart: cashBalance + cashFromMaturingThisYear + hysaInterestThisYear, // Cash inflow point-in-time
            hysaWithdrawalToCoverShortfall: hysaWithdrawalToCoverShortfall,
            withdrawalAmount: totalWithdrawalsThisYear,
            netCashFlowYear: endOfYearCash - cashBalance, // How much cash balance changed
            endOfYearCash: endOfYearCash,
            ongoingCDInvestments: ongoingCDsPrincipal, // Principal of future CDs
            endOfYearHysaBalance: currentHysaBalance, // HYSA balance end of year
            ongoingInvestmentsTotal: ongoingInvestmentsPrincipal,
            totalPortfolioValue: totalPortfolioValueEndOfYear,
            // Use the correctly calculated flag for THIS year's shortfall status
            hasShortfall: yearEndedWithShortfall,
            // This represents the shortfall amount REMAINING at the end of THIS year
            yearEndShortfallAmount: shortfallAmountThisYear // RENAMED from cumulativeShortfall
        });

        // --- Update Balances for Next Year's Loop ---
        cashBalance = endOfYearCash; // Carry forward this year's ending cash (floored at 0)
        cumulativeShortfall = shortfallAmountThisYear; // Carry forward the *actual* remaining shortfall
        // currentHysaBalance is already updated for next year
        // activeCdTranches is already updated for next year

    } // End of year loop

    // --- Final Totals Calculation ---
    const finalTotals = {
        totalInterestEarned: totalInterestEarnedCumulative,
        totalTaxesPaid: totalTaxesPaidCumulative,
        totalInterestAfterTax: totalInterestEarnedCumulative - totalTaxesPaidCumulative,
        // Use last projection year's value, or calculate initial investment value if no projection years generated
        finalPortfolioValue: projection.length > 0
            ? projection.at(-1).totalPortfolioValue
            : initialHysaBalance + initialTranches.filter(t => !t.isHYSA).reduce((sum, t) => sum + t.amount, 0)
    };

    // --- Return Results ---
    return {
        projectionYears: projection,
        hasShortfall: hasShortfallOverall, // The overall flag indicating if *any* year had a shortfall
        totals: finalTotals
    };
}
