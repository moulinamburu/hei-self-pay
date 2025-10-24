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
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [submitting, setSubmitting] = useState(false);
  const parentOriginRef = useRef(ORIGIN_ANY);

  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);

  // Allow host to pass init via URL for static hosting fallback
  useEffect(() => {
    const initFromQuery = queryParams.get('init');
    if (initFromQuery) {
      const parsed = safeParseJson(decodeURIComponent(initFromQuery));
      if (parsed) {
        setInitPayload(parsed);
        if (parsed.amount) setAmount(String(parsed.amount));
        if (parsed.currency) setCurrency(parsed.currency);
        if (parsed.receivedFrom) setReceivedFrom(parsed.receivedFrom);
        if (parsed.currencyTendered) setCurrencyTendered(parsed.currencyTendered);
        if (parsed.description) setDescription(parsed.description);
      }
    }
  }, [queryParams]);

  // postMessage handshake
  useEffect(() => {
    function post(type, data) {
      window.parent.postMessage({ source: 'payment-widget', type, data }, parentOriginRef.current);
    }

    function handleMessage(event) {
      const { data, origin } = event;
      if (!data || data.source === 'payment-widget') return;
      const { type, payload } = data;
      // Record parent's origin on first valid message
      parentOriginRef.current = origin;

      if (type === 'INIT') {
        setInitPayload(payload || {});
        if (payload?.amount) setAmount(String(payload.amount));
        if (payload?.currency) setCurrency(payload.currency);
        if (payload?.receivedFrom) setReceivedFrom(payload.receivedFrom);
        if (payload?.currencyTendered) setCurrencyTendered(payload.currencyTendered);
        if (payload?.description) setDescription(payload.description);
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
      success,
      amount: Number(amount) || 0,
      currency,
      receivedFrom,
      currencyTendered,
      description,
      paymentMethod,
      ...extra,
    };
    window.parent.postMessage({ source: 'payment-widget', type: 'RESULT', data: payload }, parentOriginRef.current);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
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

  return (
    <div className="pw-modal">
      <div className="pw-modal-header">
        <div className="pw-modal-title">Make payment</div>
      </div>

      <div className="pw-modal-body">
        <div className="pw-balance-row">
          <div className="pw-chip pw-chip-info">
            <div className="pw-chip-amount">AED20,708</div>
            <div className="pw-chip-label">Account balance</div>
          </div>
          <div className="pw-chip pw-chip-warn">
            <div className="pw-chip-amount">-AED10</div>
            <div className="pw-chip-label">Self pay balance</div>
          </div>
          <div className="pw-chip pw-chip-success">
            <div className="pw-chip-amount">AED2,262</div>
            <div className="pw-chip-label">Encounter balance</div>
          </div>
          <div className="pw-chip pw-chip-danger">
            <div className="pw-chip-amount">AED0</div>
            <div className="pw-chip-label">Patient due</div>
          </div>
        </div>

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
              </div>

              <div className="pw-field">
                <label htmlFor="currencyTendered" className="pw-label">Currency tendered</label>
                <div className="pw-select">
                  <select
                    id="currencyTendered"
                    className="pw-input"
                    value={currencyTendered}
                    onChange={(e) => setCurrencyTendered(e.target.value)}
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
                <label className="pw-radio-label">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Cash"
                    checked={paymentMethod === 'Cash'}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  />
                  <span className="pw-radio-text">Cash</span>
                </label>

                <label className="pw-radio-label">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Credit card"
                    checked={paymentMethod === 'Credit card'}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  />
                  <span className="pw-radio-text">Credit card</span>
                  <div className="pw-card-logos">
                    <span className="pw-card-logo">VISA</span>
                    <span className="pw-card-logo">Mastercard</span>
                    <span className="pw-card-logo">AMEX</span>
                    <span className="pw-card-logo">Apple Pay</span>
                  </div>
                </label>

                <label className="pw-radio-label">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Cheque"
                    checked={paymentMethod === 'Cheque'}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  />
                  <span className="pw-radio-text">Cheque</span>
                </label>

                <label className="pw-radio-label">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="Bank Transfer"
                    checked={paymentMethod === 'Bank Transfer'}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  />
                  <span className="pw-radio-text">Bank Transfer</span>
                </label>
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
              <button type="submit" className="pw-btn" disabled={submitting}>
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


