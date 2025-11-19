import React, { useEffect, useMemo, useRef, useState } from 'react';
import './payment-widget.css';

const ORIGIN_ANY = '*';

function safeParseJson(maybeJson) {
  try {
    return JSON.parse(maybeJson);
  } catch (e) {
    return null;
  }
}

// Events exchanged with host
// Host -> Widget: INIT, CANCEL
// Widget -> Host: READY, RESULT, ERROR, CANCELLED
export default function PaymentWidget() {
  const [initPayload, setInitPayload] = useState(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('AED');
  const [receivedFrom, setReceivedFrom] = useState('');
  const [currencyTendered, setCurrencyTendered] = useState('AED');
  const [description, setDescription] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [transactionAliases, setTransactionAliases] = useState([]); // [{ value: string, label: string }]
  // Split rows per payment method
  const [cashSplits, setCashSplits] = useState([]); // [{ amount: string, alias: string }]
  const [cardSplits, setCardSplits] = useState([]); // [{ amount: string, alias: string }]
  const [chequeSplits, setChequeSplits] = useState([]); // [{ amount: string, alias: string }]
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [changeDue, setChangeDue] = useState('0.00');
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [totalPaymentInputValue, setTotalPaymentInputValue] = useState('');
  const [isTotalPaymentFocused, setIsTotalPaymentFocused] = useState(false);
  const [isCardNumberFocused, setIsCardNumberFocused] = useState(false);
  const [manualTotalPayment, setManualTotalPayment] = useState(null); // null means using split-based calculation
  const [touched, setTouched] = useState({
    receivedFrom: false,
    currencyTendered: false,
    cardNumber: false,
    expiry: false,
    cvv: false,
  });
  const [fieldErrors, setFieldErrors] = useState({
    receivedFrom: '',
    currencyTendered: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    cashAliases: [],
    cardAliases: [],
    chequeAliases: [],
    cashAmounts: [],
    cardAmounts: [],
    chequeAmounts: [],
    remainingDue: '',
  });
  const parentOriginRef = useRef(ORIGIN_ANY);
  const totalPaymentInputRef = useRef(null);

  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  // Check if this is a refund operation
  const isRefund = useMemo(() => queryParams.get('isRefund') === 'true', [queryParams]);
  // Target amount to be paid: prefer manual total payment if provided, else initial amount
  const targetTotalDue = useMemo(
    () => (manualTotalPayment !== null ? (Number(manualTotalPayment) || 0) : (Number(amount || 0) || 0)),
    [manualTotalPayment, amount]
  );
  const isZero = useMemo(() => Number(targetTotalDue) === 0, [targetTotalDue]);

  // Use currencyTendered if set, otherwise fall back to currency
  const displayCurrency = useMemo(() => (currencyTendered?.trim() || currency).toUpperCase(), [currencyTendered, currency]);

  const sumSplitAmounts = React.useCallback((splits) => splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0), []);
  const cashTotal = useMemo(() => sumSplitAmounts(cashSplits), [sumSplitAmounts, cashSplits]);
  const cardTotal = useMemo(() => sumSplitAmounts(cardSplits), [sumSplitAmounts, cardSplits]);
  const chequeTotal = useMemo(() => sumSplitAmounts(chequeSplits), [sumSplitAmounts, chequeSplits]);
  const splitBasedTotal = useMemo(() => cashTotal + cardTotal + chequeTotal, [cashTotal, cardTotal, chequeTotal]);
  // Actual allocated total from payment details (splits)
  const allocatedTotal = useMemo(() => splitBasedTotal, [splitBasedTotal]);

  const formatCurrency = React.useCallback((amt) => `${displayCurrency}${(Number(amt) || 0).toLocaleString()}`, [displayCurrency]);
  const displayTotalPayment = useMemo(() => formatCurrency(targetTotalDue), [formatCurrency, targetTotalDue]);
  const displayTotalDue = useMemo(() => formatCurrency(targetTotalDue), [formatCurrency, targetTotalDue]);
  // Remaining due should be target due minus allocated (from splits)
  const remainingDue = useMemo(() => Math.max((Number(targetTotalDue) || 0) - (Number(allocatedTotal) || 0), 0), [targetTotalDue, allocatedTotal]);
  const displayRemainingDue = useMemo(() => formatCurrency(remainingDue), [formatCurrency, remainingDue]);
  const shouldShowRemainingDueError = useMemo(
    () => remainingDue > 0 && (submitAttempted || allocatedTotal > 0),
    [remainingDue, submitAttempted, allocatedTotal]
  );

  useEffect(() => {
    const totalDueNum = Number(targetTotalDue) || 0;
    const nonCashPaid = cardTotal + chequeTotal;
    const remainingBeforeCash = Math.max(totalDueNum - nonCashPaid, 0);
    const change = Math.max(cashTotal - remainingBeforeCash, 0);
    setChangeDue(change.toFixed(2));
  }, [targetTotalDue, cashTotal, cardTotal, chequeTotal]);


  // Allow host to pass init via URL for static hosting fallback
  useEffect(() => {
    const initFromQuery = queryParams.get('init');
    if (initFromQuery) {
      const parsed = safeParseJson(decodeURIComponent(initFromQuery));
      if (parsed) {
        setInitPayload(parsed);
        if (parsed.amount != null) setAmount(String(parsed.amount));
        if (parsed.payableAmount != null) setAmount(String(parsed.payableAmount));
        if (parsed.currency) setCurrency(parsed.currency);
        if (parsed.receivedFrom) setReceivedFrom(parsed.receivedFrom);
        // Keep currency tendered fixed to AED; ignore external override
        if (parsed.description) setDescription(parsed.description);
      }
    }
  }, [queryParams]);

  // postMessage handshake
  useEffect(() => {
    function post(type, data) {
      // Use wildcard origin to ensure delivery across dev hosts/ports
      window.parent.postMessage({ source: 'payment-widget', type, data }, ORIGIN_ANY);
    }

    function handleMessage(event) {
      const { data, origin } = event;
      if (!data || data.source === 'payment-widget') return;
      const { type, payload } = data;
      // Record parent's origin only for recognized host messages
      if (data && (data.source === 'patient-accounting-ui' || data.type === 'INIT' || data.type === 'CANCEL')) {
        parentOriginRef.current = origin;
      }

      if (type === 'INIT') {
        setInitPayload(payload || {});
        if (payload?.amount != null) setAmount(String(payload.amount));
        if (payload?.payableAmount != null) setAmount(String(payload.payableAmount));
        if (payload?.currency) setCurrency(payload.currency);
        if (payload?.receivedFrom) setReceivedFrom(payload.receivedFrom);
        // Keep currency tendered fixed to AED; ignore external override
        if (payload?.description) setDescription(payload.description);
        // Set transaction aliases if provided
        if (payload?.transactionAliases && Array.isArray(payload.transactionAliases)) {
          setTransactionAliases(payload.transactionAliases);
        }
      }
      if (type === 'CANCEL') {
        post('CANCELLED', { reason: 'host_cancelled' });
      }
    }

    window.addEventListener('message', handleMessage);
    // Advertise readiness
    post('READY', { version: '1.0.0' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  function emitResult(success, extra) {
    const payload = {
      // envelope
      version: '1.0',
      status: success ? 'succeeded' : 'failed',
      success,
      timestamp: new Date().toISOString(),
      // legacy flat fields (kept for backward compatibility)
      amount: Number(targetTotalDue) || 0,
      currency,
      receivedFrom,
      currencyTendered,
      description,
      paymentMethods,
      totalPayment: Number(allocatedTotal) || 0,
      remainingDue,
      // structured fields for richer consumers
      totals: {
        totalDue: Number(targetTotalDue) || 0,
        allocatedTotal: Number(allocatedTotal) || 0,
        remainingDue,
      },
      payer: {
        receivedFrom,
      },
      methodsSelected: paymentMethods,
      tenderedCurrency: currencyTendered,
      splits: {
        cash: cashSplits,
        card: cardSplits,
        cheque: chequeSplits,
      },
      // Additional payment details for API integration
      paymentDetails: {
        cardNumber: cardNumber,
        expiry: expiry,
        cvv: cvv,
        chequeNumber: chequeNumber,
        chequeDate: chequeDate,
        changeDue: Number(changeDue) || 0,
      },
      requestId: initPayload?.requestId ?? undefined,
      ...extra,
    };
    // Use wildcard origin to avoid origin mismatches in development
    window.parent.postMessage({ source: 'payment-widget', type: 'RESULT', data: payload }, ORIGIN_ANY);
  }

  function isExpiredMmYy(mmYy) {
    const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(mmYy);
    if (!match) return true;
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    const now = new Date();
    const endOfMonth = new Date(year, month, 0); // last day of month
    endOfMonth.setHours(23, 59, 59, 999);
    return endOfMonth < now;
  }

  function validateAll() {
    const errs = {
      receivedFrom: '',
      currencyTendered: '',
      cardNumber: '',
      expiry: '',
      cvv: '',
      cashAliases: [],
      cardAliases: [],
      chequeAliases: [],
      cashAmounts: [],
      cardAmounts: [],
      chequeAmounts: [],
      remainingDue: '',
    };

    if (!receivedFrom) errs.receivedFrom = 'Required';
    // currency tendered is fixed to AED; no validation needed

    if (paymentMethods.includes('Cash')) {
      errs.cashAliases = cashSplits.map(s => (s.alias ? '' : 'Select a payment alias'));
      errs.cashAmounts = cashSplits.map(s => (s.amount !== '' && Number(s.amount) <= 0 ? 'Amount should be greater than 0' : ''));
    }
    if (paymentMethods.includes('Cheque')) {
      errs.chequeAliases = chequeSplits.map(s => (s.alias ? '' : 'Select a payment alias'));
      errs.chequeAmounts = chequeSplits.map(s => (s.amount !== '' && Number(s.amount) <= 0 ? 'Amount should be greater than 0' : ''));
    }
    if (paymentMethods.includes('Credit card')) {
      errs.cardAliases = cardSplits.map(s => (s.alias ? '' : 'Select a payment alias'));
      errs.cardAmounts = cardSplits.map(s => (s.amount !== '' && Number(s.amount) <= 0 ? 'Amount should be greater than 0' : ''));
      const digits = (cardNumber || '').replace(/\D/g, '');
      if (!digits) errs.cardNumber = 'Enter last 4 digits of card';
      else if (!/^\d{4}$/.test(digits)) errs.cardNumber = 'Enter exactly 4 digits';

      if (!expiry) errs.expiry = 'Enter expiry';
      else if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) errs.expiry = 'Enter valid MM/YY';
      else if (isExpiredMmYy(expiry)) errs.expiry = 'Card expired';

      if (!cvv) errs.cvv = 'Enter authorization number';
    }

    // Block if remaining due is greater than zero (underpayment)
    if (remainingDue > 0) {
      errs.remainingDue = 'Please pay the full amount';
    }

    return errs;
  }

  function hasAnyError(errs) {
    const aliasArrays = [...(errs.cashAliases || []), ...(errs.cardAliases || []), ...(errs.chequeAliases || [])];
    const amountArrays = [...(errs.cashAmounts || []), ...(errs.cardAmounts || []), ...(errs.chequeAmounts || [])];
    return Boolean(
      errs.receivedFrom ||
      // currencyTendered is fixed; no error contribution
      errs.cardNumber ||
      errs.expiry ||
      errs.cvv ||
      errs.remainingDue ||
      aliasArrays.some(Boolean) ||
      amountArrays.some(Boolean)
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const errs = validateAll();
    setFieldErrors(errs);
    setSubmitAttempted(true);
    // Block submission if any validation errors are present
    if (hasAnyError(errs)) return;
    setSubmitting(true);
    // Simulate processing delay; integrate real API here
    setTimeout(() => {
      setSubmitting(false);
      emitResult(true, { transactionId: Date.now().toString() });
    }, 600);
  }

  function handleCancel() {
    window.parent.postMessage({ source: 'payment-widget', type: 'CANCELLED', data: { reason: 'user' } }, parentOriginRef.current);
  }

  function handlePaymentMethodToggle(method) {
    setPaymentMethods(prev => {
      const isSelected = prev.includes(method);
      const next = isSelected ? prev.filter(m => m !== method) : [...prev, method];

      // Initialize a first split when turning on a method; clear when turning off
      if (!isSelected) {
        if (method === 'Cash' && cashSplits.length === 0) {
          setCashSplits([{ amount: '', alias: '' }]);
        }
        if (method === 'Credit card' && cardSplits.length === 0) {
          setCardSplits([{ amount: '', alias: '' }]);
        }
        if (method === 'Cheque' && chequeSplits.length === 0) {
          setChequeSplits([{ amount: '', alias: '' }]);
        }
      } else {
        if (method === 'Cash') setCashSplits([]);
        if (method === 'Credit card') setCardSplits([]);
        if (method === 'Cheque') setChequeSplits([]);
      }

      return next;
    });
  }

  // Format amount to 2 decimal places
  function formatAmount(value) {
    if (!value || value === '') return '';
    const num = Number(value);
    if (isNaN(num)) return value;
    return num.toFixed(2);
  }

  // Split helpers
  function addCashSplit() {
    setCashSplits(prev => [...prev, { amount: '', alias: '' }]);
  }
  function updateCashSplit(index, field, value) {
    setCashSplits(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }
  function handleCashAmountBlur(index) {
    setCashSplits(prev => prev.map((s, i) =>
      i === index && s.amount ? { ...s, amount: formatAmount(s.amount) } : s
    ));
  }

  function addCardSplit() {
    setCardSplits(prev => [...prev, { amount: '', alias: '' }]);
  }
  function updateCardSplit(index, field, value) {
    setCardSplits(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }
  function handleCardAmountBlur(index) {
    setCardSplits(prev => prev.map((s, i) =>
      i === index && s.amount ? { ...s, amount: formatAmount(s.amount) } : s
    ));
  }

  function addChequeSplit() {
    setChequeSplits(prev => [...prev, { amount: '', alias: '' }]);
  }
  function updateChequeSplit(index, field, value) {
    setChequeSplits(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }
  function handleChequeAmountBlur(index) {
    setChequeSplits(prev => prev.map((s, i) =>
      i === index && s.amount ? { ...s, amount: formatAmount(s.amount) } : s
    ));
  }

  function handleChequeDateChange(e) {
    let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
    if (value.length >= 2) {
      value = value.slice(0, 2) + '/' + value.slice(2);
    }
    if (value.length >= 5) {
      value = value.slice(0, 5) + '/' + value.slice(5, 9);
    }
    setChequeDate(value);
  }

  function handleExpiryChange(e) {
    let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
    if (value.length >= 2) {
      value = value.slice(0, 2) + '/' + value.slice(2, 4);
    }
    setExpiry(value);
  }

  function handleCardNumberChange(e) {
    // Only accept digits and limit to 4 digits (last 4 of card)
    let value = e.target.value.replace(/\D/g, '');
    value = value.slice(0, 4);
    setCardNumber(value);
  }

  function formatCardNumberDisplay(lastFour) {
    if (!lastFour) return '';
    // Display as **** **** **** 1234
    return `**** **** **** ${lastFour}`;
  }

  // Allow direct editing of Total Payment - this becomes the target amount to distribute
  function handleTotalPaymentInputChange(e) {
    const raw = e.target.value || '';
    // Keep only digits and dot, limit to one dot
    const sanitized = raw
      .replace(/[^0-9.]/g, '')
      .replace(/(\..*)\./g, '$1');

    setTotalPaymentInputValue(sanitized);
    // Set manual total payment as the user types
    if (sanitized === '') {
      setManualTotalPayment(null);
    } else {
      setManualTotalPayment(sanitized);
    }
  }
  function handleTotalPaymentFocus() {
    setIsTotalPaymentFocused(true);
    // When focusing, populate input value based on current state
    if (manualTotalPayment !== null) {
      setTotalPaymentInputValue(String(manualTotalPayment));
    } else if (targetTotalDue > 0) {
      setTotalPaymentInputValue(String(targetTotalDue));
    }
  }
  function handleTotalPaymentBlur() {
    setIsTotalPaymentFocused(false);
    // Format the value and set as manual total payment
    const valueToFormat = totalPaymentInputValue || '';
    const formattedValue = valueToFormat ? formatAmount(valueToFormat) : '';

    if (formattedValue) {
      setManualTotalPayment(formattedValue);
    } else {
      setManualTotalPayment(null);
    }
    setTotalPaymentInputValue('');
  }

  return (
    <div className="pw-modal" style={{ width: '100%', position: 'relative' }}>
      <div className="pw-modal-header">
        <div className="pw-modal-title">{isRefund ? 'Process refund' : 'Make payment'}</div>
      </div>

      <div className="pw-modal-body" style={{ position: 'relative' }}>
        <div className="pw-balance-row">
          <div className="pw-chip pw-chip-success">
            <div className="pw-chip-amount">
              <div className="pw-input-affix">
                <span className="pw-affix">{displayCurrency}</span>
                <input
                  ref={totalPaymentInputRef}
                  id="totalPaymentEditable"
                  className="pw-input pw-input-affixed"
                  type="text"
                  value={
                    isTotalPaymentFocused
                      ? totalPaymentInputValue
                      : (manualTotalPayment !== null
                          ? formatAmount(manualTotalPayment)
                          : (targetTotalDue > 0 ? formatAmount(targetTotalDue) : ''))
                  }
                  onChange={handleTotalPaymentInputChange}
                  onFocus={handleTotalPaymentFocus}
                  onBlur={handleTotalPaymentBlur}
                  placeholder="0.00"
                  aria-label={isRefund ? "Edit total refund" : "Edit total payment"}
                  title={isRefund ? "Click to edit total refund" : "Click to edit total payment"}
                />
                <span className="pw-suffix" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 13.5V17h3.5L16.06 7.44l-3.5-3.5L3 13.5z" fill="#0f172a" fillOpacity="0.55" />
                    <path d="M17.71 6.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.15 1.15 3.5 3.5 1.4-1.4z" fill="#0f172a" fillOpacity="0.55" />
                  </svg>
                </span>
              </div>
            </div>
            <div className="pw-chip-label">{isRefund ? 'Total Refund' : 'Total Payment'}</div>
          </div>
          {true && (
            <>
              <div className="pw-chip pw-chip-info">
                <div className="pw-chip-amount">{displayTotalDue}</div>
                <div className="pw-chip-label">Total Due</div>
              </div>
              <div className="pw-chip pw-chip-warn">
                <div className="pw-chip-amount">{displayRemainingDue}</div>
                <div className="pw-chip-label">Remaining Due</div>
              </div>
            </>
          )}
        </div>
        {shouldShowRemainingDueError && (
          <div className="pw-error">Please pay the full amount</div>
        )}

        {/* Toast notification when total payment is 0 */}
        {isZero && (
          <div className="pw-toast" style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            padding: '12px 16px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: '8px',
            color: '#856404',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            maxWidth: '400px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            zIndex: 1000
          }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span><strong>Please enter the total {isRefund ? 'refund' : 'payment'} amount</strong> to proceed with {isRefund ? 'refund' : 'payment'} details.</span>
          </div>
        )}

        <div className="pw-section">
          {!isZero && (
            <>
              <div className="pw-section-title">{isRefund ? 'Refund details' : 'Payment details'}</div>
              <form className="pw-form" onSubmit={handleSubmit}>
                {/* Received From and Currency Tendered */}
                <div className="pw-form-row">
                  <div className="pw-field">
                    <label htmlFor="receivedFrom" className="pw-label">Received from</label>
                    <input
                      id="receivedFrom"
                      className="pw-input"
                      type="text"
                      value={receivedFrom}
                      onChange={(e) => setReceivedFrom(e.target.value)}
                      onBlur={() => { setTouched(prev => ({ ...prev, receivedFrom: true })); setFieldErrors(validateAll()); }}
                      placeholder="e.g., Patient, Insurance, or name"
                    />
                    {(touched.receivedFrom || submitAttempted) && fieldErrors.receivedFrom && (
                      <div className="pw-error">{fieldErrors.receivedFrom}</div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="pw-field">
                  <label htmlFor="description" className="pw-label">Description</label>
                  <textarea
                    id="description"
                    className="pw-textarea"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Write description here"
                    rows="3"
                  />
                </div>

                {/* Payment Method Section */}
                <div className="pw-section-subtitle">{isRefund ? 'Refund method' : 'Payment method'}</div>

                <div className="pw-payment-methods">
                  <div className="pw-radio-group">
                    <label className="pw-checkbox-label">
                      <input
                        type="checkbox"
                        name="paymentMethod"
                        value="Cash"
                        checked={paymentMethods.includes('Cash')}
                        onChange={() => handlePaymentMethodToggle('Cash')}
                      />
                      <span className="pw-checkbox-text">Cash</span>
                    </label>

                    {/* Cash Details Section */}
                    {paymentMethods.includes('Cash') && (
                      <div className="pw-credit-card-details-inline">
                        {/* Split rows: Enter Amount and Payment Alias side by side */}
                        {cashSplits.map((split, idx) => (
                          <div className="pw-form-row" key={`cash-split-${idx}`}>
                            <div className="pw-field">
                              <label htmlFor={`cashAmount-${idx}`} className="pw-label">Enter amount</label>
                              <div className="pw-input-affix">
                                <span className="pw-affix">{displayCurrency}</span>
                                <input
                                  id={`cashAmount-${idx}`}
                                  className="pw-input pw-input-affixed"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={split.amount}
                                  onChange={(e) => updateCashSplit(idx, 'amount', e.target.value)}
                                  onBlur={() => handleCashAmountBlur(idx)}
                                  placeholder="0"
                                />
                              </div>
                              {((submitAttempted && fieldErrors.cashAmounts[idx]) || (split.amount !== '' && Number(split.amount) === 0)) && (
                                <div className="pw-error">{fieldErrors.cashAmounts[idx] || 'Amount should be greater than 0'}</div>
                              )}
                              {isZero && idx === cashSplits.length - 1 && (
                                <button type="button" className="pw-link-btn" onClick={addCashSplit}>+ Add</button>
                              )}
                            </div>

                            <div className="pw-field">
                              <label htmlFor={`cashAlias-${idx}`} className="pw-label">Payment alias</label>
                              <div className="pw-select">
                                <select
                                  id={`cashAlias-${idx}`}
                                  className="pw-input"
                                  value={split.alias}
                                  onChange={(e) => updateCashSplit(idx, 'alias', e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {transactionAliases.map((alias) => (
                                    <option key={alias.value} value={alias.value}>
                                      {alias.label}
                                    </option>
                                  ))}
                                </select>
                                <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                              {submitAttempted && fieldErrors.cashAliases[idx] && (
                                <div className="pw-error">{fieldErrors.cashAliases[idx]}</div>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Change Due Field */}
                        <div className="pw-field">
                          <label htmlFor="changeDue" className="pw-label">Change due</label>
                          <input
                            id="changeDue"
                            className="pw-input pw-input-readonly"
                            type="text"
                            value={`${displayCurrency} ${changeDue}`}
                            readOnly
                          />
                        </div>
                      </div>
                    )}

                    <label className="pw-checkbox-label">
                      <input
                        type="checkbox"
                        name="paymentMethod"
                        value="Credit card"
                        checked={paymentMethods.includes('Credit card')}
                        onChange={() => handlePaymentMethodToggle('Credit card')}
                      />
                      <span className="pw-checkbox-text">Credit card</span>
                    </label>

                    {/* Credit Card Details Section */}
                    {paymentMethods.includes('Credit card') && (
                      <div className="pw-credit-card-details-inline">
                        {/* Split rows: Enter Amount and Payment Alias side by side */}
                        {cardSplits.map((split, idx) => (
                          <div className="pw-form-row" key={`card-split-${idx}`}>
                            <div className="pw-field">
                              <label htmlFor={`cardAmount-${idx}`} className="pw-label">Enter amount</label>
                              <div className="pw-input-affix">
                                <span className="pw-affix">{displayCurrency}</span>
                                <input
                                  id={`cardAmount-${idx}`}
                                  className="pw-input pw-input-affixed"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={split.amount}
                                  onChange={(e) => updateCardSplit(idx, 'amount', e.target.value)}
                                  onBlur={() => handleCardAmountBlur(idx)}
                                  placeholder="0"
                                />
                              </div>
                              {((submitAttempted && fieldErrors.cardAmounts[idx]) || (split.amount !== '' && Number(split.amount) === 0)) && (
                                <div className="pw-error">{fieldErrors.cardAmounts[idx] || 'Amount should be greater than 0'}</div>
                              )}
                              {isZero && idx === cardSplits.length - 1 && (
                                <button type="button" className="pw-link-btn" onClick={addCardSplit}>+ Add</button>
                              )}
                              {idx === cardSplits.length - 1 && (
                                <div className="pw-pos-button-container">
                                  <button type="button" className="pw-btn pw-btn-pos">
                                    POS
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="pw-field">
                              <label htmlFor={`paymentAlias-${idx}`} className="pw-label">Payment alias</label>
                              <div className="pw-select">
                                <select
                                  id={`paymentAlias-${idx}`}
                                  className="pw-input"
                                  value={split.alias}
                                  onChange={(e) => updateCardSplit(idx, 'alias', e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {transactionAliases.map((alias) => (
                                    <option key={alias.value} value={alias.value}>
                                      {alias.label}
                                    </option>
                                  ))}
                                </select>
                                <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                              {submitAttempted && fieldErrors.cardAliases[idx] && (
                                <div className="pw-error">{fieldErrors.cardAliases[idx]}</div>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Second Row: Card Number, Expiry, and CVV */}
                        <div className="pw-form-row pw-form-row-three">
                          <div className="pw-field">
                            <label htmlFor="cardNumber" className="pw-label">Card number (Last 4 digits)</label>
                            <input
                              id="cardNumber"
                              className="pw-input"
                              type="text"
                              value={isCardNumberFocused ? cardNumber : (cardNumber ? formatCardNumberDisplay(cardNumber) : '')}
                              onChange={handleCardNumberChange}
                              onFocus={() => {
                                setIsCardNumberFocused(true);
                              }}
                              onBlur={() => { 
                                setIsCardNumberFocused(false);
                                setTouched(prev => ({ ...prev, cardNumber: true })); 
                                setFieldErrors(validateAll()); 
                              }}
                              placeholder="**** **** **** 1234"
                              maxLength="4"
                            />
                            {(touched.cardNumber || submitAttempted) && fieldErrors.cardNumber && (
                              <div className="pw-error">{fieldErrors.cardNumber}</div>
                            )}
                          </div>

                          <div className="pw-field">
                            <label htmlFor="expiry" className="pw-label">Expiry</label>
                            <input
                              id="expiry"
                              className="pw-input"
                              type="text"
                              value={expiry}
                              onChange={handleExpiryChange}
                              onBlur={() => { setTouched(prev => ({ ...prev, expiry: true })); setFieldErrors(validateAll()); }}
                              placeholder="MM/YY"
                              maxLength="5"
                            />
                            {(touched.expiry || submitAttempted) && fieldErrors.expiry && (
                              <div className="pw-error">{fieldErrors.expiry}</div>
                            )}
                          </div>

                          <div className="pw-field">
                            <label htmlFor="cvv" className="pw-label">Authorization Number</label>
                            <input
                              id="cvv"
                              className="pw-input"
                              type="text"
                              value={cvv}
                              onChange={(e) => setCvv(e.target.value)}
                              onBlur={() => { setTouched(prev => ({ ...prev, cvv: true })); setFieldErrors(validateAll()); }}
                            />
                            {(touched.cvv || submitAttempted) && fieldErrors.cvv && (
                              <div className="pw-error">{fieldErrors.cvv}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <label className="pw-checkbox-label">
                      <input
                        type="checkbox"
                        name="paymentMethod"
                        value="Cheque"
                        checked={paymentMethods.includes('Cheque')}
                        onChange={() => handlePaymentMethodToggle('Cheque')}
                      />
                      <span className="pw-checkbox-text">Cheque</span>
                    </label>

                    {/* Cheque Details Section */}
                    {paymentMethods.includes('Cheque') && (
                      <div className="pw-credit-card-details-inline">
                        {/* Split rows: Enter Amount and Payment Alias side by side */}
                        {chequeSplits.map((split, idx) => (
                          <div className="pw-form-row" key={`cheque-split-${idx}`}>
                            <div className="pw-field">
                              <label htmlFor={`chequeAmount-${idx}`} className="pw-label">Enter amount</label>
                              <div className="pw-input-affix">
                                <span className="pw-affix">{displayCurrency}</span>
                                <input
                                  id={`chequeAmount-${idx}`}
                                  className="pw-input pw-input-affixed"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={split.amount}
                                  onChange={(e) => updateChequeSplit(idx, 'amount', e.target.value)}
                                  onBlur={() => handleChequeAmountBlur(idx)}
                                  placeholder="0"
                                />
                              </div>
                              {((submitAttempted && fieldErrors.chequeAmounts[idx]) || (split.amount !== '' && Number(split.amount) === 0)) && (
                                <div className="pw-error">{fieldErrors.chequeAmounts[idx] || 'Amount should be greater than 0'}</div>
                              )}
                              {isZero && idx === chequeSplits.length - 1 && (
                                <button type="button" className="pw-link-btn" onClick={addChequeSplit}>+ Add</button>
                              )}
                            </div>

                            <div className="pw-field">
                              <label htmlFor={`chequeAlias-${idx}`} className="pw-label">Payment alias</label>
                              <div className="pw-select">
                                <select
                                  id={`chequeAlias-${idx}`}
                                  className="pw-input"
                                  value={split.alias}
                                  onChange={(e) => updateChequeSplit(idx, 'alias', e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {transactionAliases.map((alias) => (
                                    <option key={alias.value} value={alias.value}>
                                      {alias.label}
                                    </option>
                                  ))}
                                </select>
                                <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                              {submitAttempted && fieldErrors.chequeAliases[idx] && (
                                <div className="pw-error">{fieldErrors.chequeAliases[idx]}</div>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Second Row: Cheque Number and Cheque Date */}
                        <div className="pw-form-row">
                          <div className="pw-field">
                            <label htmlFor="chequeNumber" className="pw-label">Cheque Number</label>
                            <input
                              id="chequeNumber"
                              className="pw-input"
                              type="text"
                              value={chequeNumber}
                              onChange={(e) => setChequeNumber(e.target.value)}
                              placeholder="000000"
                              maxLength="20"
                            />
                          </div>

                          <div className="pw-field">
                            <label htmlFor="chequeDate" className="pw-label">Cheque date</label>
                            <input
                              id="chequeDate"
                              className="pw-input"
                              type="text"
                              value={chequeDate}
                              onChange={handleChequeDateChange}
                              placeholder="MM/DD/YYYY"
                              maxLength="10"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* Actions */}
                <div className="pw-actions">
                  {/* <button
                    type="button"
                    className="pw-btn pw-btn-secondary"
                    onClick={handleCancel}
                    disabled={submitting}
                  >
                    Cancel
                  </button> */}
                  <button
                    type="submit"
                    className="pw-btn"
                    disabled={submitting || remainingDue > 0}
                  >
                    {submitting ? 'Processing…' : 'Submit'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


