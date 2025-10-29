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
  const [currencyTendered, setCurrencyTendered] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([]);
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

  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isZero = useMemo(() => Number(amount || 0) === 0, [amount]);

  const sumSplitAmounts = React.useCallback((splits) => splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0), []);
  const cashTotal = useMemo(() => sumSplitAmounts(cashSplits), [sumSplitAmounts, cashSplits]);
  const cardTotal = useMemo(() => sumSplitAmounts(cardSplits), [sumSplitAmounts, cardSplits]);
  const chequeTotal = useMemo(() => sumSplitAmounts(chequeSplits), [sumSplitAmounts, chequeSplits]);
  const totalPayment = useMemo(() => cashTotal + cardTotal + chequeTotal, [cashTotal, cardTotal, chequeTotal]);

  const formatCurrency = React.useCallback((amt) => `${currency}${(Number(amt) || 0).toLocaleString()}`,[currency]);
  const displayTotalPayment = useMemo(() => formatCurrency(totalPayment), [formatCurrency, totalPayment]);
  const displayTotalDue = useMemo(() => formatCurrency(amount || 0), [formatCurrency, amount]);
  const remainingDue = useMemo(() => Math.max((Number(amount || 0) || 0) - totalPayment, 0), [amount, totalPayment]);
  const displayRemainingDue = useMemo(() => formatCurrency(remainingDue), [formatCurrency, remainingDue]);
  const shouldShowRemainingDueError = useMemo(
    () => remainingDue > 0 && (submitAttempted || totalPayment > 0),
    [remainingDue, submitAttempted, totalPayment]
  );

  useEffect(() => {
    const totalDueNum = Number(amount || 0) || 0;
    const nonCashPaid = cardTotal + chequeTotal;
    const remainingBeforeCash = Math.max(totalDueNum - nonCashPaid, 0);
    const change = Math.max(cashTotal - remainingBeforeCash, 0);
    setChangeDue(change.toFixed(2));
  }, [amount, cashTotal, cardTotal, chequeTotal]);

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
        if (parsed.currencyTendered) setCurrencyTendered(parsed.currencyTendered);
        if (parsed.description) setDescription(parsed.description);
        if ((parsed.payableAmount != null && Number(parsed.payableAmount) === 0) || (parsed.amount != null && Number(parsed.amount) === 0)) {
          setPaymentMethods(prev => (prev.includes('Credit card') ? prev : ['Credit card']));
          setCardSplits(prev => (prev.length > 0 ? prev : [{ amount: '', alias: '' }]));
        }
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
        if (payload?.currencyTendered) setCurrencyTendered(payload.currencyTendered);
        if (payload?.description) setDescription(payload.description);
        // If payableAmount is 0, ensure a default method is visible so +Add is shown
        const incoming = payload?.payableAmount ?? payload?.amount;
        if (incoming != null && Number(incoming) === 0) {
          setPaymentMethods(prev => (prev.includes('Credit card') ? prev : ['Credit card']));
          setCardSplits(prev => (prev.length > 0 ? prev : [{ amount: '', alias: '' }]));
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
      amount: Number(amount) || 0,
      currency,
      receivedFrom,
      currencyTendered,
      description,
      paymentMethods,
      totalPayment,
      remainingDue,
      // structured fields for richer consumers
      totals: {
        totalPayment,
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
    if (!currencyTendered) errs.currencyTendered = 'Required';

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
      const digits = (cardNumber || '').replace(/\s+/g, '');
      if (!digits) errs.cardNumber = 'Enter card number';
      else if (!/^\d{12,19}$/.test(digits)) errs.cardNumber = 'Enter a valid card number';

      if (!expiry) errs.expiry = 'Enter expiry';
      else if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) errs.expiry = 'Enter valid MM/YY';
      else if (isExpiredMmYy(expiry)) errs.expiry = 'Card expired';

      if (!cvv) errs.cvv = 'Enter CVV';
      else if (!/^\d{3,4}$/.test(cvv)) errs.cvv = 'Enter valid CVV';
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
      errs.currencyTendered ||
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

  // Split helpers
  function addCashSplit() {
    setCashSplits(prev => [...prev, { amount: '', alias: '' }]);
  }
  function updateCashSplit(index, field, value) {
    setCashSplits(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addCardSplit() {
    setCardSplits(prev => [...prev, { amount: '', alias: '' }]);
  }
  function updateCardSplit(index, field, value) {
    setCardSplits(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addChequeSplit() {
    setChequeSplits(prev => [...prev, { amount: '', alias: '' }]);
  }
  function updateChequeSplit(index, field, value) {
    setChequeSplits(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  return (
    <div className="pw-modal">
      <div className="pw-modal-header">
        <div className="pw-modal-title">Make payment</div>
      </div>

      <div className="pw-modal-body">
        <div className="pw-balance-row">
          {!isZero && (
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
          <div className="pw-chip pw-chip-success">
            <div className="pw-chip-amount">{displayTotalPayment}</div>
            <div className="pw-chip-label">Total Payment</div>
          </div>
        </div>
        {shouldShowRemainingDueError && (
          <div className="pw-error">Please pay the full amount</div>
        )}

        <div className="pw-section">
          <div className="pw-section-title">Payment details</div>
          <form className="pw-form" onSubmit={handleSubmit}>
            {/* Received From and Currency Tendered */}
            <div className="pw-form-row">
              <div className="pw-field">
                <label htmlFor="receivedFrom" className="pw-label">Received from</label>
                <div className="pw-select">
                  <select 
                    id="receivedFrom" 
                    className="pw-input" 
                    value={receivedFrom}
                    onChange={(e) => setReceivedFrom(e.target.value)}
                    onBlur={() => { setTouched(prev => ({ ...prev, receivedFrom: true })); setFieldErrors(validateAll()); }}
                  >
                    <option value="">Select</option>
                    <option value="patient">Patient</option>
                    <option value="insurance">Insurance</option>
                    <option value="other">Other</option>
                  </select>
                  <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {(touched.receivedFrom || submitAttempted) && fieldErrors.receivedFrom && (
                  <div className="pw-error">{fieldErrors.receivedFrom}</div>
                )}
              </div>

              <div className="pw-field">
                <label htmlFor="currencyTendered" className="pw-label">Currency tendered</label>
                <div className="pw-select">
                  <select
                    id="currencyTendered"
                    className="pw-input"
                    value={currencyTendered}
                    onChange={(e) => setCurrencyTendered(e.target.value)}
                    onBlur={() => { setTouched(prev => ({ ...prev, currencyTendered: true })); setFieldErrors(validateAll()); }}
                  >
                    <option value="">Select</option>
                    <option value="AED">AED</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                  <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {(touched.currencyTendered || submitAttempted) && fieldErrors.currencyTendered && (
                  <div className="pw-error">{fieldErrors.currencyTendered}</div>
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
            <div className="pw-section-subtitle">Payment method</div>
            
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
                            <span className="pw-affix">AED</span>
                            <input
                              id={`cashAmount-${idx}`}
                              className="pw-input pw-input-affixed"
                              type="number"
                              min="0"
                              step="0.01"
                              value={split.amount}
                              onChange={(e) => updateCashSplit(idx, 'amount', e.target.value)}
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
                              <option value="cash1">Cash *1234</option>
                              <option value="cash2">Cash *5678</option>
                            </select>
                            <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                        value={`AED ${changeDue}`}
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
                  <div className="pw-card-logos">
                    <svg width="34" height="24" viewBox="0 0 34 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" fill="white"/>
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" stroke="#F2F4F7"/>
                      <path fillRule="evenodd" clipRule="evenodd" d="M10.7503 15.8583H8.69056L7.146 9.79247C7.07269 9.51344 6.91703 9.26676 6.68806 9.1505C6.11664 8.85833 5.48696 8.6258 4.80005 8.50853V8.27499H8.11813C8.57607 8.27499 8.91953 8.6258 8.97677 9.03323L9.77817 13.4087L11.8369 8.27499H13.8394L10.7503 15.8583ZM14.9843 15.8583H13.039L14.6408 8.27499H16.5861L14.9843 15.8583ZM19.1028 10.3758C19.16 9.96738 19.5035 9.73384 19.9042 9.73384C20.5338 9.6752 21.2197 9.79248 21.7922 10.0836L22.1356 8.45091C21.5632 8.21737 20.9335 8.1001 20.3621 8.1001C18.4741 8.1001 17.1003 9.1505 17.1003 10.6083C17.1003 11.7174 18.0734 12.2997 18.7603 12.6505C19.5035 13.0003 19.7897 13.2338 19.7324 13.5836C19.7324 14.1083 19.16 14.3419 18.5886 14.3419C17.9017 14.3419 17.2147 14.167 16.5861 13.8748L16.2426 15.5086C16.9295 15.7997 17.6727 15.917 18.3596 15.917C20.4766 15.9746 21.7922 14.9252 21.7922 13.3501C21.7922 11.3666 19.1028 11.2503 19.1028 10.3758ZM28.6 15.8583L27.0555 8.27499H25.3965C25.053 8.27499 24.7095 8.50853 24.5951 8.85833L21.7349 15.8583H23.7374L24.1371 14.7503H26.5976L26.8265 15.8583H28.6ZM25.6827 10.3172L26.2541 13.1752H24.6523L25.6827 10.3172Z" fill="#172B85"/>
                    </svg>
                    <svg width="34" height="24" viewBox="0 0 34 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" fill="white"/>
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" stroke="#F2F4F7"/>
                      <path d="M21.5771 5.03003C25.322 5.03003 28.3584 8.02992 28.3584 11.7302C28.3583 15.4304 25.322 18.4304 21.5771 18.4304C19.8982 18.4304 18.3629 17.8256 17.1787 16.8269C15.9945 17.8255 14.4591 18.4304 12.7803 18.4304C9.03566 18.4302 6.00011 15.4303 6 11.7302C6 8.03005 9.03559 5.03025 12.7803 5.03003C14.459 5.03003 15.9945 5.63411 17.1787 6.63257C18.3629 5.63397 19.8983 5.03006 21.5771 5.03003Z" fill="#ED0006"/>
                      <path d="M21.5774 5.03003C25.3222 5.03011 28.3577 8.02997 28.3577 11.7302C28.3576 15.4304 25.3221 18.4303 21.5774 18.4304C19.8985 18.4304 18.3632 17.8256 17.179 16.8269C18.6361 15.598 19.5617 13.7715 19.5618 11.7302C19.5618 9.68873 18.6363 7.86147 17.179 6.63257C18.3631 5.63403 19.8986 5.03003 21.5774 5.03003Z" fill="#F9A000"/>
                      <path d="M17.1785 6.63257C18.636 7.86147 19.5613 9.68859 19.5613 11.7302C19.5612 13.7716 18.6358 15.598 17.1785 16.8269C15.7215 15.5981 14.7967 13.7713 14.7966 11.7302C14.7966 9.68889 15.7213 7.86146 17.1785 6.63257Z" fill="#FF5E00"/>
                    </svg>
                    <svg width="34" height="24" viewBox="0 0 34 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" fill="#1F72CD"/>
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" stroke="#F2F4F7"/>
                      <path fillRule="evenodd" clipRule="evenodd" d="M6.09517 8.5L2.91406 15.7467H6.7223L7.19441 14.5913H8.27355L8.74566 15.7467H12.9375V14.8649L13.311 15.7467H15.4793L15.8528 14.8462V15.7467H24.5706L25.6307 14.6213L26.6232 15.7467L31.1009 15.7561L27.9097 12.1436L31.1009 8.5H26.6927L25.6608 9.60463L24.6995 8.5H15.2156L14.4013 10.3704L13.5678 8.5H9.7675V9.35186L9.34474 8.5H6.09517ZM6.83205 9.52905H8.68836L10.7984 14.4431V9.52905H12.8319L14.4617 13.0524L15.9637 9.52905H17.987V14.7291H16.7559L16.7458 10.6544L14.9509 14.7291H13.8495L12.0446 10.6544V14.7291H9.51179L9.03162 13.5633H6.43745L5.95827 14.728H4.60123L6.83205 9.52905ZM24.1196 9.52905H19.1134V14.726H24.0421L25.6307 13.0036L27.1618 14.726H28.7624L26.436 12.1426L28.7624 9.52905H27.2313L25.6507 11.2316L24.1196 9.52905ZM7.73508 10.4089L6.8804 12.4856H8.58876L7.73508 10.4089ZM20.3497 11.555V10.6057V10.6048H23.4734L24.8364 12.1229L23.413 13.6493H20.3497V12.613H23.0808V11.555H20.3497Z" fill="white"/>
                    </svg>
                    <svg width="34" height="24" viewBox="0 0 34 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" fill="white"/>
                      <rect x="0.5" y="0.5" width="33" height="23" rx="3.5" stroke="#F2F4F7"/>
                      <path fillRule="evenodd" clipRule="evenodd" d="M9.44921 8.34316C9.16382 8.69506 8.70721 8.97261 8.2506 8.93296C8.19353 8.45715 8.41707 7.95161 8.67867 7.63936C8.96406 7.27755 9.46348 7.01983 9.86777 7C9.91533 7.49563 9.72983 7.98135 9.44921 8.34316ZM9.86297 9.02712C9.46071 9.003 9.09366 9.15319 8.79718 9.2745C8.60639 9.35256 8.44483 9.41867 8.32191 9.41867C8.18397 9.41867 8.01574 9.34903 7.82685 9.27084L7.82685 9.27084C7.57935 9.16838 7.29638 9.05124 6.99964 9.05686C6.31948 9.06677 5.68688 9.46823 5.33967 10.1076C4.62621 11.3863 5.15417 13.2796 5.84384 14.3205C6.18155 14.8359 6.58584 15.4009 7.11855 15.3811C7.35291 15.3719 7.5215 15.2973 7.69597 15.2202C7.89683 15.1314 8.10549 15.0391 8.43131 15.0391C8.74582 15.0391 8.94536 15.129 9.1369 15.2152C9.31903 15.2973 9.49393 15.376 9.75358 15.3712C10.3053 15.3613 10.6525 14.8557 10.9902 14.3403C11.3547 13.7871 11.5148 13.2471 11.5391 13.1652L11.542 13.1557C11.5414 13.1551 11.5369 13.153 11.5289 13.1492C11.4071 13.0911 10.476 12.6469 10.467 11.4557C10.4581 10.4559 11.2056 9.94935 11.3233 9.86961L11.3233 9.8696C11.3304 9.86476 11.3353 9.86149 11.3374 9.85978C10.8618 9.12625 10.1198 9.04695 9.86297 9.02712ZM13.6824 15.3167V7.5898H16.4649C17.9013 7.5898 18.9049 8.62071 18.9049 10.1274C18.9049 11.6341 17.8822 12.675 16.4268 12.675H14.8334V15.3167H13.6824ZM14.8333 8.60088H16.1603C17.1592 8.60088 17.7299 9.15599 17.7299 10.1324C17.7299 11.1088 17.1592 11.6688 16.1556 11.6688H14.8333V8.60088ZM22.7053 14.3898C22.4009 14.9945 21.7302 15.3761 21.0072 15.3761C19.9371 15.3761 19.1903 14.712 19.1903 13.7108C19.1903 12.7196 19.9133 12.1496 21.2498 12.0653L22.6862 11.9761V11.5499C22.6862 10.9204 22.2915 10.5784 21.5875 10.5784C21.0072 10.5784 20.5839 10.8907 20.4983 11.3665H19.4614C19.4947 10.3653 20.3984 9.63675 21.6208 9.63675C22.9383 9.63675 23.7945 10.3554 23.7945 11.4706V15.3167H22.729V14.3898H22.7053ZM21.3163 14.4592C20.7027 14.4592 20.3127 14.1519 20.3127 13.6811C20.3127 13.1954 20.6885 12.9129 21.4067 12.8683L22.6861 12.784V13.2202C22.6861 13.9438 22.0964 14.4592 21.3163 14.4592ZM27.3284 15.619C26.867 16.9721 26.3391 17.4181 25.2166 17.4181C25.131 17.4181 24.8456 17.4082 24.779 17.3884V16.4616C24.8503 16.4715 25.0263 16.4814 25.1167 16.4814C25.6256 16.4814 25.911 16.2584 26.087 15.6785L26.1916 15.3365L24.2415 9.7111H25.4449L26.8004 14.2759H26.8242L28.1798 9.7111H29.3499L27.3284 15.619Z" fill="black"/>
                    </svg>
                  </div>
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
                            <span className="pw-affix">AED</span>
                            <input
                              id={`cardAmount-${idx}`}
                              className="pw-input pw-input-affixed"
                              type="number"
                              min="0"
                              step="0.01"
                              value={split.amount}
                              onChange={(e) => updateCardSplit(idx, 'amount', e.target.value)}
                              placeholder="0"
                            />
                          </div>
                          {((submitAttempted && fieldErrors.cardAmounts[idx]) || (split.amount !== '' && Number(split.amount) === 0)) && (
                            <div className="pw-error">{fieldErrors.cardAmounts[idx] || 'Amount should be greater than 0'}</div>
                          )}
                          {isZero && idx === cardSplits.length - 1 && (
                            <button type="button" className="pw-link-btn" onClick={addCardSplit}>+ Add</button>
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
                              <option value="visa1">VISA *1234</option>
                              <option value="mastercard1">Mastercard *5678</option>
                            </select>
                            <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                        <label htmlFor="cardNumber" className="pw-label">Card number</label>
                        <input
                          id="cardNumber"
                          className="pw-input"
                          type="text"
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value)}
                          onBlur={() => { setTouched(prev => ({ ...prev, cardNumber: true })); setFieldErrors(validateAll()); }}
                          placeholder="1234 5678 9012 3456"
                          maxLength="19"
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
                          onChange={(e) => setExpiry(e.target.value)}
                          onBlur={() => { setTouched(prev => ({ ...prev, expiry: true })); setFieldErrors(validateAll()); }}
                          placeholder="MM/YY"
                          maxLength="5"
                        />
                        {(touched.expiry || submitAttempted) && fieldErrors.expiry && (
                          <div className="pw-error">{fieldErrors.expiry}</div>
                        )}
                      </div>

                      <div className="pw-field">
                        <label htmlFor="cvv" className="pw-label">CVV</label>
                        <input
                          id="cvv"
                          className="pw-input"
                          type="password"
                          value={cvv}
                          onChange={(e) => setCvv(e.target.value)}
                          onBlur={() => { setTouched(prev => ({ ...prev, cvv: true })); setFieldErrors(validateAll()); }}
                          placeholder="***"
                          maxLength="4"
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
                            <span className="pw-affix">AED</span>
                            <input
                              id={`chequeAmount-${idx}`}
                              className="pw-input pw-input-affixed"
                              type="number"
                              min="0"
                              step="0.01"
                              value={split.amount}
                              onChange={(e) => updateChequeSplit(idx, 'amount', e.target.value)}
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
                              <option value="cheque1">Cheque *1234</option>
                              <option value="cheque2">Cheque *5678</option>
                            </select>
                            <svg className="pw-caret" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M4 6L8 10L12 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
                          onChange={(e) => setChequeDate(e.target.value)}
                          placeholder="MM/DD"
                          maxLength="5"
                        />
                      </div>
                    </div>
                  </div>
                )}

               
              </div>
            </div>

            {/* Actions */}
            <div className="pw-actions">
              <button
                type="button"
                className="pw-btn pw-btn-secondary"
                onClick={handleCancel}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pw-btn"
                disabled={submitting || remainingDue > 0}
              >
                {submitting ? 'Processing…' : 'Submit'}
              </button>
            </div>
          </form>
        </div>

        {initPayload && (
          <div className="pw-debug">
            <div className="pw-debug-title">Init payload</div>
            <pre>{JSON.stringify(initPayload, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}


