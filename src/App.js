// src/App.js
import React, { useState, useEffect, useCallback } from 'react';
import { calculateProjections } from './utils/projectionLogic';
import './App.css';

// --- Default Interest Rates (Example) ---
const DEFAULT_INTEREST_RATES = {
  'HYSA': { duration: null, apy: 3.6 },
  '6m': { duration: 6, apy: 3.8 },
  '9m': { duration: 9, apy: 3.8 },
  '12m': { duration: 12, apy: 4.0 },
  '18m': { duration: 18, apy: 3.7 },
  '24m': { duration: 24, apy: 3.5 },
  '30m': { duration: 30, apy: 3.5 },
  '36m': { duration: 36, apy: 3.5 },
  '48m': { duration: 48, apy: 3.5 },
  '60m': { duration: 60, apy: 3.5 },
};

// --- Helper to generate unique IDs ---
let trancheIdCounter = 0;
let withdrawalIdCounter = 0;
const generateTrancheId = () => `tranche-${trancheIdCounter++}`;
const generateWithdrawalId = () => `withdrawal-${withdrawalIdCounter++}`;

// --- Formatting Helper ---
const formatCurrency = (value) => {
    // Handle potential non-numeric values gracefully
    const numValue = Number(value);
    if (isNaN(numValue)) {
        return '$0.00'; // Or some other placeholder for invalid input
    }
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numValue);
};


function App() {
  // --- Input State ---
  const [investmentStartDate, setInvestmentStartDate] = useState('2025-01-01');
  const [lumpSum, setLumpSum] = useState(100000);
  const [taxRate, setTaxRate] = useState(25);
  // eslint-disable-next-line no-unused-vars
  const [interestRates, setInterestRates] = useState(DEFAULT_INTEREST_RATES); // State setter kept for future use
  const [tranches, setTranches] = useState([
    // Default example tranches
    { id: generateTrancheId(), amount: 50000, term: '12m', reinvestmentOption: 'cash', reinvestmentTerm: '12m' },
    { id: generateTrancheId(), amount: 50000, term: 'HYSA', reinvestmentOption: null, reinvestmentTerm: null },
 ]);
  const [withdrawals, setWithdrawals] = useState([
     // Default example withdrawals
     { id: generateWithdrawalId(), date: '2026-09-01', amount: 20000 },
     { id: generateWithdrawalId(), date: '2027-09-01', amount: 20000 },
  ]);

  // --- Output State ---
  const [projectionResults, setProjectionResults] = useState(null);
  const [calculationError, setCalculationError] = useState(null);
  const [allocatedAmount, setAllocatedAmount] = useState(0);

  // --- Calculate Allocated Amount ---
  useEffect(() => {
    // Ensure amounts are numbers before summing
    const totalAllocated = tranches.reduce((sum, tranche) => sum + (Number(tranche.amount) || 0), 0);
    setAllocatedAmount(totalAllocated);
  }, [tranches]);


  // --- Run Projection Calculation ---
  const runCalculation = useCallback(() => {
    // Basic Validation
    if (!investmentStartDate || lumpSum === undefined || lumpSum === null || taxRate === undefined || taxRate === null || isNaN(Number(taxRate))) {
      setCalculationError("Please fill in Start Date, Lump Sum, and a valid Tax Rate.");
      setProjectionResults(null);
      return;
    }
    // Ensure lumpSum is treated as a number for comparison
    const numLumpSum = Number(lumpSum) || 0;
    const numAllocatedAmount = Number(allocatedAmount) || 0;

    // Error if lump sum requires allocation but none is done
    if (tranches.length === 0 && numLumpSum > 0) {
        setCalculationError("Please add at least one investment tranche to allocate the lump sum.");
        setProjectionResults(null);
        return;
    }

    // Check for allocation mismatch warning
    // Use a small tolerance for floating point comparisons
    const allocationMismatch = Math.abs(numAllocatedAmount - numLumpSum) > 0.01;
    const hasTranches = tranches.length > 0;

    if (allocationMismatch && hasTranches) {
        // Set warning but allow calculation
        setCalculationError(`Warning: Allocated amount (${formatCurrency(numAllocatedAmount)}) doesn't match Lump Sum (${formatCurrency(numLumpSum)}). Calculation runs on allocated amount.`);
    } else if (calculationError?.startsWith('Warning:') && (!allocationMismatch || !hasTranches)) {
        // Clear only allocation warning if amounts match OR there are no tranches to allocate
        setCalculationError(null);
    }


      try {
          // Ensure all inputs passed to calculation are numbers where expected
          const results = calculateProjections({
              investmentStartDate,
              lumpSum: Number(lumpSum) || 0, // Ensure number
              taxRate: Number(taxRate) || 0,   // Ensure number
              tranches, // Pass the state with reinvestment properties
              withdrawals,
              interestRates
          });

           if (results.error) {
              // Avoid overwriting allocation warning with calculation error
              if (!calculationError?.startsWith('Warning:')) {
                  setCalculationError(`Calculation Error: ${results.error}`);
              }
              setProjectionResults(null);
          } else {
             setProjectionResults(results);
             // Clear non-warning calculation errors on success
             if (!calculationError?.startsWith('Warning:')) {
                setCalculationError(null);
             }
          }

      } catch (error) {
          console.error("Projection Calculation Failed:", error);
          // Avoid overwriting allocation warning
          if (!calculationError?.startsWith('Warning:')) {
              setCalculationError(`An unexpected error occurred: ${error.message}`);
          }
          setProjectionResults(null);
      }
  // Add calculationError to dependency array to help manage error state clearing/persistence logic
  }, [investmentStartDate, lumpSum, taxRate, tranches, withdrawals, interestRates, allocatedAmount, calculationError]);


   // --- Effect to Run Calculation on Input Change ---
   useEffect(() => {
       runCalculation();
   // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [runCalculation]); // runCalculation includes all dependencies


  // --- Input Handlers ---
  const handleTrancheChange = (id, field, value) => {
    setTranches(prevTranches =>
      prevTranches.map(t =>
        t.id === id ? { ...t, [field]: value } : t
      )
    );
  };

  const addTranche = () => {
    setTranches(prevTranches => [
      ...prevTranches,
      // Default new tranche is a CD with reinvestment options
      { id: generateTrancheId(), amount: '', term: '12m', reinvestmentOption: 'cash', reinvestmentTerm: '12m' }
    ]);
  };

  const removeTranche = (id) => {
    setTranches(prevTranches => prevTranches.filter(t => t.id !== id));
  };

  const handleWithdrawalChange = (id, field, value) => {
    setWithdrawals(prevWithdrawals =>
      prevWithdrawals.map(w =>
        w.id === id ? { ...w, [field]: value } : w
      )
    );
  };

  const addWithdrawal = () => {
    setWithdrawals(prevWithdrawals => [
      ...prevWithdrawals,
      { id: generateWithdrawalId(), date: '', amount: '' }
    ]);
  };

  const removeWithdrawal = (id) => {
    setWithdrawals(prevWithdrawals => prevWithdrawals.filter(w => w.id !== id));
  };

  // Get available CD terms (non-HYSA) for dropdowns
  const cdTerms = Object.keys(interestRates).filter(term => term !== 'HYSA');

  return (
    <div className="App">
      <h1>CD Ladder Investment Model</h1>

      {/* --- Input Section --- */}
      <div className="input-section card">
        <h2>Inputs</h2>

        {/* Input Grid for Start Date, Lump Sum, Tax Rate */}
        <div className="input-grid">
            <div>
              <label htmlFor="startDate">Investment Start Date:</label>
              <input type="date" id="startDate" value={investmentStartDate} onChange={(e) => setInvestmentStartDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="lumpSum">Lump Sum Amount:</label>
              <input type="number" id="lumpSum" value={lumpSum} onChange={(e) => setLumpSum(e.target.value)} placeholder="e.g., 100000" step="1000" min="0" />
            </div>
            <div>
              <label htmlFor="taxRate">Marginal Tax Rate (%):</label>
              <input type="number" id="taxRate" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="e.g., 25" min="0" max="100" step="0.1" />
            </div>
        </div>

        {/* --- Tranches Input --- */}
        <div className="input-subsection">
          <h3>Investment Tranches</h3>
          <p>Define how the lump sum is allocated across different CD terms or a High-Yield Savings Account (HYSA).</p>
          {/* Allocation Summary */}
          <p>
              Total Allocated: <strong className={Math.abs((Number(allocatedAmount) || 0) - (Number(lumpSum) || 0)) > 0.01 ? 'mismatch' : 'match'}>{formatCurrency(allocatedAmount)}</strong> / {formatCurrency(lumpSum)}
          </p>
          {/* Tranche Rows */}
          {tranches.map((tranche) => (
            <div key={tranche.id} className={`input-row ${tranche.term === 'HYSA' ? 'hysa-row' : 'tranche-row'}`}>
              {/* Amount Input */}
              <input
                type="number"
                placeholder="Amount"
                value={tranche.amount}
                onChange={(e) => handleTrancheChange(tranche.id, 'amount', e.target.value)}
                step="1000"
                min="0"
              />
              {/* Term Select */}
              <select
                value={tranche.term}
                onChange={(e) => handleTrancheChange(tranche.id, 'term', e.target.value)}
              >
                {Object.keys(interestRates).map(termKey => (
                  <option key={termKey} value={termKey}>
                    {termKey} ({interestRates[termKey].apy}%)
                  </option>
                ))}
              </select>

              {/* --- START: Reinvestment UI (Only for CDs) --- */}
              {tranche.term !== 'HYSA' && (
                <> {/* Use Fragment to group elements */}
                  <label htmlFor={`reinvestOpt-${tranche.id}`} className="inline-label">On Maturity:</label>
                  <select
                    id={`reinvestOpt-${tranche.id}`}
                    value={tranche.reinvestmentOption}
                    onChange={(e) => handleTrancheChange(tranche.id, 'reinvestmentOption', e.target.value)}
                    className="reinvest-select"
                    aria-label={`Reinvestment option for tranche ${tranche.id}`} // Accessibility
                  >
                    <option value="cash">Hold as Cash</option>
                    <option value="hysa">Move to HYSA</option>
                    <option value="newCD">Reinvest in New CD</option>
                  </select>

                  {/* Show term selection only if reinvesting in new CD */}
                  {tranche.reinvestmentOption === 'newCD' && (
                    <select
                      value={tranche.reinvestmentTerm}
                      onChange={(e) => handleTrancheChange(tranche.id, 'reinvestmentTerm', e.target.value)}
                      className="reinvest-select"
                      aria-label={`Reinvestment term for tranche ${tranche.id}`} // Accessibility
                    >
                      {/* Populate with available CD terms */}
                      {cdTerms.map(termKey => (
                         <option key={termKey} value={termKey}>
                           {termKey} ({interestRates[termKey].apy}%) {/* Show rate for clarity */}
                         </option>
                       ))}
                    </select>
                  )}
                </>
              )}
              {/* --- END: Reinvestment UI --- */}

              {/* Remove Button */}
              <button onClick={() => removeTranche(tranche.id)} className="remove-btn">Remove</button>
            </div>
          ))}
          {/* Add Tranche Button */}
          <button onClick={addTranche}>+ Add Tranche</button>
        </div>


        {/* --- Withdrawals Input --- */}
        <div className="input-subsection">
          <h3>Planned Withdrawals</h3>
          <p>Specify future dates and amounts you plan to withdraw (e.g., tuition payments).</p>
          {withdrawals.map((withdrawal) => (
            <div key={withdrawal.id} className="input-row withdrawal-row">
              <input
                type="date"
                value={withdrawal.date}
                onChange={(e) => handleWithdrawalChange(withdrawal.id, 'date', e.target.value)}
              />
              <input
                type="number"
                placeholder="Amount"
                value={withdrawal.amount}
                onChange={(e) => handleWithdrawalChange(withdrawal.id, 'amount', e.target.value)}
                 step="1000"
                 min="0"
              />
              <button onClick={() => removeWithdrawal(withdrawal.id)} className="remove-btn">Remove</button>
            </div>
          ))}
          <button onClick={addWithdrawal}>+ Add Withdrawal</button>
        </div>

        {/* --- Calculation Errors/Warnings --- */}
        {/* Render error/warning only if it exists */}
        {calculationError && <p className={`error-message ${calculationError.startsWith('Warning:') ? 'warning-message-inline' : ''}`}>{calculationError}</p>}

      </div> {/* End Input Section Card */}


      {/* --- Output Section --- */}
      {/* Conditionally render only if results exist AND there wasn't a blocking calculation error */}
      {projectionResults && !projectionResults.error && (
        <div className="output-section">
          <h2>Projections</h2>

          {/* --- Summary --- */}
          <div className="summary-section card">
             <h3>Summary</h3>
             {projectionResults.hasShortfall && (
                // Make summary warning consistent with annual details logic
                <p className="warning-message">⚠️ Warning: Uncovered shortfall detected in one or more years! Check annual details.</p>
             )}
             <div className="summary-grid">
                <p>Total Interest Earned: <strong>{formatCurrency(projectionResults.totals.totalInterestEarned)}</strong></p>
                <p>Estimated Taxes Paid: <strong>{formatCurrency(projectionResults.totals.totalTaxesPaid)}</strong></p>
                <p>Interest After Tax: <strong>{formatCurrency(projectionResults.totals.totalInterestAfterTax)}</strong></p>
                <p>Final Portfolio Value: <strong>{formatCurrency(projectionResults.totals.finalPortfolioValue)}</strong></p>
            </div>
          </div>

          {/* --- Yearly Breakdown --- */}
          <div className="timeline-section card">
            <h3>Annual Projection Details</h3>
            {/* Make table horizontally scrollable on small screens */}
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <table>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Maturing CDs</th>
                    <th>Reinvested</th> {/* Value reinvested */}
                    <th>Interest (CDs)</th>
                    <th>Interest (HYSA)</th>
                    <th>Total Interest</th>
                    <th>Taxes Due</th>
                    <th>Cash Avail. Start</th> {/* Cash before W/D, Tax */}
                    <th>Withdrawals</th>
                    <th>HYSA Used</th>
                    <th>End Cash</th>
                    <th>Ongoing CDs (Princpl.)</th> {/* Principal */}
                    <th>End HYSA</th>
                    <th>Total Value</th>
                    <th>Shortfall?</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Ensure projectionYears is an array before mapping */}
                  {Array.isArray(projectionResults.projectionYears) && projectionResults.projectionYears.map((yearData) => (
                    <tr key={yearData.year} className={yearData.hasShortfall ? 'shortfall-year' : ''}>
                      <td>{yearData.year}</td>
                      <td>{formatCurrency(yearData.maturingValue)}</td>
                      {/* Display the value that was reinvested */}
                      <td>{formatCurrency(yearData.reinvestedValue)}</td>
                      <td>{formatCurrency(yearData.interestFromCDs)}</td>
                      <td>{formatCurrency(yearData.interestFromHYSA)}</td>
                      <td>{formatCurrency(yearData.yearlyInterest)}</td>
                      <td>{formatCurrency(yearData.taxesDue)}</td>
                      <td>{formatCurrency(yearData.cashAvailableStart)}</td>
                      <td>{formatCurrency(yearData.withdrawalAmount)}</td>
                      <td>{formatCurrency(yearData.hysaWithdrawalToCoverShortfall)}</td>
                      <td>{formatCurrency(yearData.endOfYearCash)}</td>
                      <td>{formatCurrency(yearData.ongoingCDInvestments)}</td>
                      <td>{formatCurrency(yearData.endOfYearHysaBalance)}</td>
                      <td><strong>{formatCurrency(yearData.totalPortfolioValue)}</strong></td>
                      {/* Use the UPDATED property name here */}
                      <td className={yearData.hasShortfall ? 'warning-message' : ''}>
                        {yearData.hasShortfall ? `Yes (${formatCurrency(yearData.yearEndShortfallAmount)})` : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div> {/* End scrollable div */}
          </div> {/* End Timeline Card */}
        </div> // End Output Section
      )}
    </div> // End App
  );
}

export default App;