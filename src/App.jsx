import React, { useState, useEffect } from 'react';
import { apiFetch, setAuth, clearAuth, getStoredUser, formatINR } from './api';

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [tab, setTab] = useState('catalogue');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('student@edumart.test');
  const [password, setPassword] = useState('password123');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [cartIds, setCartIds] = useState([]);
  const [couponCode, setCouponCode] = useState('');
  const [quote, setQuote] = useState(null);
  const [libraryItems, setLibraryItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [readerInfo, setReaderInfo] = useState(null);
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminStats, setAdminStats] = useState(null);

  const products = [
    { id: 1, type: 'chapter', targetId: 2, name: 'Polynomials — Chapter Notes', sub: 'CBSE Class 10 • Mathematics', pricePaise: 4900, access: 'Lifetime', materialId: 2 },
    { id: 2, type: 'chapter', targetId: 3, name: 'Pair of Linear Equations', sub: 'CBSE Class 10 • Mathematics', pricePaise: 4900, access: 'Lifetime', materialId: 3 },
    { id: 3, type: 'chapter', targetId: 4, name: 'Quadratic Equations', sub: 'CBSE Class 10 • Mathematics', pricePaise: 4900, access: 'Lifetime', materialId: 4 },
    { id: 4, type: 'chapter', targetId: 5, name: 'Arithmetic Progressions', sub: 'CBSE Class 10 • Mathematics', pricePaise: 4900, access: 'Lifetime', materialId: 5 },
    { id: 5, type: 'subject', targetId: 1, name: 'Complete Mathematics Pack', sub: 'All Chapters + Future Updates', pricePaise: 49900, access: 'Lifetime' },
    { id: 6, type: 'subject', targetId: 2, name: 'Complete Science Pack', sub: 'Physics, Chemistry & Biology', pricePaise: 49900, access: 'Lifetime' },
    { id: 7, type: 'subject', targetId: 3, name: 'Complete Social Science Pack', sub: 'History, Civics, Geo & Eco', pricePaise: 49900, access: 'Lifetime' },
    { id: 8, type: 'monthly_pass', targetId: 1, name: 'Class 10 All-Access Monthly Pass', sub: 'Unlimited Access to All Subjects', pricePaise: 29900, access: '30 Days' },
    { id: 9, type: 'annual_pass', targetId: 1, name: 'Class 10 All-Access Annual Pass', sub: 'Best Value • Full Year Coverage', pricePaise: 249900, access: '365 Days' },
  ];

  const notify = (t, isErr = false) => { setErr(isErr ? t : ''); setMsg(isErr ? '' : t); };

  useEffect(() => {
    if (user) {
      apiFetch('/library/my-library').then(d => setLibraryItems(d.items || [])).catch(() => {});
      apiFetch('/library/orders').then(d => setOrders(d.orders || [])).catch(() => {});
      if (user.role === 'admin') {
        apiFetch('/admin/orders').then(d => setAdminOrders(d.orders || [])).catch(() => {});
        apiFetch('/admin/dashboard').then(d => setAdminStats(d)).catch(() => {});
      }
    }
  }, [user]);

  useEffect(() => {
    if (user && cartIds.length > 0) {
      apiFetch('/payments/quote', { method: 'POST', body: JSON.stringify({ productIds: cartIds, couponCode }) })
        .then(q => { setQuote(q); setErr(''); })
        .catch(e => { setQuote(null); notify(e.message, true); });
    } else setQuote(null);
  }, [cartIds, couponCode, user]);

  async function handleAuth(e) {
    e.preventDefault();
    try {
      const data = await apiFetch(isRegister ? '/auth/register' : '/auth/login', {
        method: 'POST', body: JSON.stringify(isRegister ? { name, email, password } : { email, password }),
      });
      setAuth(data.token, data.user); setUser(data.user); notify(`Welcome back, ${data.user.name}`);
    } catch (e) { notify(e.message, true); }
  }

  function isOwned(p) {
    if (libraryItems.some(e => e.scope_type === 'class' && e.scope_id === 1)) return true;
    if (p.type === 'chapter') return libraryItems.some(e => (e.scope_type === 'chapter' && e.scope_id === p.targetId) || (e.scope_type === 'subject' && e.scope_id === 1));
    if (p.type === 'subject') return libraryItems.some(e => e.scope_type === 'subject' && e.scope_id === p.targetId);
    return false;
  }

  async function handleCheckout() {
    try {
      const od = await apiFetch('/payments/create-order', { method: 'POST', body: JSON.stringify({ productIds: cartIds, couponCode }) });
      const rzp = new window.Razorpay({
        key: od.keyId, amount: od.amountPaise, currency: 'INR', name: 'EduMart', description: 'Study Material', order_id: od.razorpayOrderId,
        handler: async (resp) => {
          await apiFetch('/payments/verify', { method: 'POST', body: JSON.stringify(resp) });
          notify('Payment confirmed. Access unlocked in My Library.'); setCartIds([]); setTab('library');
          const lib = await apiFetch('/library/my-library'); setLibraryItems(lib.items || []);
        },
        prefill: { name: user.name, email: user.email },
        theme: { color: '#000000' },
      });
      rzp.on('payment.failed', (r) => notify(`Payment failed: ${r.error?.description}`, true));
      rzp.open();
    } catch (e) { notify(e.message, true); }
  }

  async function openMaterial(id, title) {
    try {
      const res = await apiFetch(`/library/materials/${id}/read`);
      if (res instanceof Blob) window.open(URL.createObjectURL(res), '_blank');
      else setReaderInfo({ title, ...res });
    } catch (e) { notify(e.message, true); }
  }

  const s = {
    page: { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", background: '#f6f6f6', minHeight: '100vh', color: '#000', margin: 0 },
    nav: { background: '#000', color: '#fff', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 },
    navBtn: (active) => ({ background: active ? '#fff' : 'transparent', color: active ? '#000' : '#fff', border: 'none', padding: '8px 16px', borderRadius: 999, fontWeight: 600, cursor: 'pointer', fontSize: 14 }),
    hero: { background: '#000', color: '#fff', padding: '36px 32px 48px', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
    container: { maxWidth: 1120, margin: '0 auto', padding: '24px 20px' },
    card: { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #eaeaea', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' },
    btnBlack: { background: '#000', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
    btnGray: { background: '#eeeeee', color: '#000', border: 'none', padding: '10px 16px', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
    input: { padding: '12px 14px', borderRadius: 10, border: '1px solid #d4d4d4', fontSize: 14, outline: 'none' },
    pill: (bg, fg) => ({ background: bg, color: fg, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }),
  };

  return (
    <div style={s.page}>
      {/* Uber-Style Top Black Navbar */}
      <header style={s.nav}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>EduMart</span>
          <span style={{ fontSize: 12, background: '#262626', padding: '4px 10px', borderRadius: 999, color: '#a3a3a3' }}>CBSE • Class 10</span>
        </div>
        <nav style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={s.navBtn(tab === 'catalogue')} onClick={() => setTab('catalogue')}>Explore</button>
          {user && <>
            <button style={s.navBtn(tab === 'cart')} onClick={() => setTab('cart')}>Cart ({cartIds.length})</button>
            <button style={s.navBtn(tab === 'library')} onClick={() => setTab('library')}>My Library</button>
            <button style={s.navBtn(tab === 'orders')} onClick={() => setTab('orders')}>Orders</button>
            {user.role === 'admin' && <button style={s.navBtn(tab === 'admin')} onClick={() => setTab('admin')}>Admin</button>}
            <button style={{ ...s.navBtn(false), color: '#f87171' }} onClick={() => { clearAuth(); setUser(null); }}>Sign out</button>
          </>}
        </nav>
      </header>

      {/* Hero Banner */}
      <div style={s.hero}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>Study smarter, unlock instantly.</h1>
          <p style={{ margin: '0 0 20px', color: '#a3a3a3', fontSize: 15 }}>Buy individual chapters, upgrade to full subject packs with credit, or get an All-Access Pass.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              placeholder="Search chapters, subjects, or passes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...s.input, width: 320, border: 'none', background: '#fff' }}
            />
            <button style={{ ...s.btnGray, background: '#262626', color: '#fff' }} onClick={() => openMaterial(1, 'Math Ch.1 (Free Sample)')}>
              Free Math Sample
            </button>
            <button style={{ ...s.btnGray, background: '#262626', color: '#fff' }} onClick={() => openMaterial(6, 'Science Ch.1 (Free Sample)')}>
              Free Science Sample
            </button>
          </div>
        </div>
      </div>

      <main style={s.container}>
        {msg && <div style={{ background: '#000', color: '#4ade80', padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontWeight: 600 }}>{msg}</div>}
        {err && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 12, marginBottom: 16, fontWeight: 600 }}>{err}</div>}

        {!user && (
          <div style={{ ...s.card, marginBottom: 24, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h3 style={{ margin: '0 0 4px' }}>{isRegister ? 'Create your student account' : 'Sign in to purchase & read'}</h3>
              <small style={{ color: '#666' }}>Demo: student@edumart.test or admin@edumart.test (password123)</small>
            </div>
            <form onSubmit={handleAuth} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isRegister && <input style={s.input} placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} required />}
              <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
              <button style={s.btnBlack} type="submit">{isRegister ? 'Sign Up' : 'Sign In'}</button>
              <button style={s.btnGray} type="button" onClick={() => setIsRegister(!isRegister)}>{isRegister ? 'Have account?' : 'New user?'}</button>
            </form>
          </div>
        )}

        {readerInfo && (
          <div style={{ ...s.card, background: '#ecfdf5', borderColor: '#6ee7b7', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={s.pill('#059669', '#fff')}>UNLOCKED READER</span>
                <h3 style={{ margin: '8px 0 4px' }}>{readerInfo.title}</h3>
                <p style={{ margin: 0, color: '#065f46', fontSize: 14 }}>{readerInfo.message}</p>
              </div>
              <button style={s.btnBlack} onClick={() => setReaderInfo(null)}>Close</button>
            </div>
          </div>
        )}

        {tab === 'catalogue' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {['all', 'chapter', 'subject', 'monthly_pass', 'annual_pass'].map(t => (
                <button key={t} onClick={() => setFilterType(t)} style={filterType === t ? s.btnBlack : s.btnGray}>
                  {t === 'all' ? 'All Items' : t.replace('_', ' ').toUpperCase()}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 18 }}>
              {products
                .filter(p => (filterType === 'all' || p.type === filterType) && p.name.toLowerCase().includes(search.toLowerCase()))
                .map(p => {
                  const owned = isOwned(p);
                  const inCart = cartIds.includes(p.id);
                  const isUpgrade = !owned && p.type === 'subject' && p.targetId === 1 && libraryItems.some(e => e.scope_type === 'chapter');
                  return (
                    <div key={p.id} style={s.card}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <span style={s.pill('#f3f4f6', '#111')}>{p.type.replace('_', ' ').toUpperCase()}</span>
                          {owned && <span style={s.pill('#dcfce7', '#166534')}>OWNED</span>}
                          {isUpgrade && <span style={s.pill('#fef3c7', '#92400e')}>UPGRADE CREDIT</span>}
                        </div>
                        <h3 style={{ margin: '0 0 6px', fontSize: 18 }}>{p.name}</h3>
                        <p style={{ margin: '0 0 14px', color: '#666', fontSize: 13 }}>{p.sub} • {p.access}</p>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 14 }}>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 800 }}>{formatINR(p.pricePaise)}</div>
                          <div style={{ fontSize: 11, color: '#737373' }}>Incl. 18% GST</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {p.materialId && <button style={s.btnGray} onClick={() => openMaterial(p.materialId, p.name)}>Read</button>}
                          {!owned && (
                            <button
                              style={{ ...s.btnBlack, background: inCart ? '#dc2626' : '#000' }}
                              onClick={() => user ? setCartIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id]) : notify('Please sign in first', true)}
                            >
                              {inCart ? 'Remove' : isUpgrade ? 'Upgrade' : 'Add'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {tab === 'cart' && (
          <div style={{ ...s.card, maxWidth: 640, margin: '0 auto' }}>
            <h2 style={{ marginTop: 0 }}>Checkout Summary</h2>
            {cartIds.length === 0 ? <p style={{ color: '#666' }}>Your cart is empty.</p> : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input style={{ ...s.input, flex: 1 }} placeholder="Promo code (WELCOME10 / FLAT50)" value={couponCode} onChange={e => setCouponCode(e.target.value)} />
                </div>
                {quote && (
                  <div>
                    {quote.items.map(i => (
                      <div key={i.productId} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                        <div>
                          <strong>{i.name}</strong>
                          {i.upgradeCreditPaise > 0 && <div style={{ fontSize: 12, color: '#16a34a' }}>Upgrade credit: -{formatINR(i.upgradeCreditPaise)}</div>}
                        </div>
                        <strong>{formatINR(i.finalItemPaise)}</strong>
                      </div>
                    ))}
                    <div style={{ marginTop: 16, lineHeight: 1.9, fontSize: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Taxable Value</span><span>{formatINR(quote.basePaise)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>GST (18%)</span><span>{formatINR(quote.gstPaise)}</span></div>
                      {quote.discountPaise > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#16a34a' }}><span>Discount</span><span>-{formatINR(quote.discountPaise)}</span></div>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 800, borderTop: '2px solid #000', paddingTop: 10, marginTop: 8 }}>
                        <span>Total</span><span>{formatINR(quote.totalPaise)}</span>
                      </div>
                    </div>
                    <button style={{ ...s.btnBlack, width: '100%', marginTop: 18, padding: 14, fontSize: 16 }} onClick={handleCheckout}>
                      Pay {formatINR(quote.totalPaise)} with Razorpay
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'library' && (
          <div>
            <h2>My Library</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              {libraryItems.length === 0 ? <p style={{ color: '#666' }}>No unlocked items yet.</p> : libraryItems.map(i => (
                <div key={i.id} style={{ ...s.card, flexDirection: 'row', alignItems: 'center' }}>
                  <div>
                    <span style={s.pill('#dcfce7', '#166534')}>{i.scope_type.toUpperCase()}</span>
                    <h3 style={{ margin: '6px 0 2px' }}>{i.title}</h3>
                    <small style={{ color: '#666' }}>Valid until: {i.expires_at ? new Date(i.expires_at).toLocaleDateString() : 'Lifetime'}</small>
                  </div>
                  <button style={s.btnBlack} onClick={() => openMaterial(2, i.title)}>Open Notes</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'orders' && (
          <div style={s.card}>
            <h2 style={{ marginTop: 0 }}>Order History & GST Invoices</h2>
            {orders.map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #eee' }}>
                <div>
                  <strong>Order #{o.id}</strong> • <span style={s.pill(o.status === 'paid' ? '#dcfce7' : '#fee2e2', o.status === 'paid' ? '#166534' : '#991b1b')}>{o.status.toUpperCase()}</span>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Total: {formatINR(o.total_paise)} (Incl. 18% GST: {formatINR(o.gst_paise)})</div>
                </div>
                {o.status === 'paid' && <button style={s.btnGray} onClick={() => window.print()}>Print Invoice</button>}
              </div>
            ))}
          </div>
        )}

        {tab === 'admin' && user?.role === 'admin' && (
          <div>
            <h2>Admin Overview</h2>
            {adminStats && (
            
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div style={s.card}><small style={{ color: '#666' }}>TOTAL REVENUE</small><h2 style={{ margin: '6px 0 0' }}>{formatINR(adminStats.totalRevenuePaise)}</h2></div>
                <div style={s.card}><small style={{ color: '#666' }}>ACTIVE PASSES</small><h2 style={{ margin: '6px 0 0' }}>{adminStats.activePasses}</h2></div>
              </div>
            )}
            <div style={s.card}>
              <h3 style={{ marginTop: 0 }}>Recent Orders</h3>
              {adminOrders.map(o => (
                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eee' }}>
                  <span>#{o.id} — {o.student_email}</span>
                  <strong>{formatINR(o.total_paise)} ({o.status.toUpperCase()})</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}