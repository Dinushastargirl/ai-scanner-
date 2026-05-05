import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Search, 
  LogOut, 
  X, 
  ArrowLeft, 
  CheckCircle, 
  ScanLine,
  Loader2,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface User {
  id: number;
  username: string;
  role: string;
  branch_id?: number;
  branch_name?: string;
}

interface Record {
  id: number;
  ticket_number: string;
  name: string;
  nic: string;
  item_description: string;
  weight: string;
  loan_amount: number;
  interest_rate: number;
  status: 'ACTIVE' | 'REDEEMED' | 'OVERDUE';
  created_at: string;
}

export default function App() {
  const [view, setView] = useState<'login' | 'main' | 'scanner' | 'edit'>('login');
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [branches, setBranches] = useState<{id: number, name: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [currentCapture, setCurrentCapture] = useState<string | null>(null);
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [formData, setFormData] = useState({
    ticket_number: '',
    name: '',
    nic: '',
    item_description: '',
    weight: '',
    loan_amount: '',
    interest_rate: '',
    type: 'TICKET' as 'TICKET' | 'RECEIPT'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      setView('main');
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadRecords();
      loadBranches();
    }
  }, [token, searchQuery, branchFilter]);

  const loadRecords = async () => {
    try {
      const res = await fetch(`/api/records?query=${encodeURIComponent(searchQuery)}&branch_id=${branchFilter}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) setRecords(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadBranches = async () => {
    try {
      const res = await fetch('/api/branches', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) setBranches(data);
    } catch (err) {}
  };

  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    const formData = new FormData(e.currentTarget);
    const username = formData.get('username');
    const password = formData.get('password');

    console.log('Attempting login for:', username);

    try {
      console.log('Sending login request...');
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      console.log('Login response status:', res.status);
      
      const text = await res.text();
      console.log('Login raw response:', text);

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('Server returned invalid JSON. Check server logs.');
      }

      if (data.token) {
        console.log('Login successful, saving token');
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        setView('main');
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err: any) {
      console.error('Login fetch error:', err);
      setLoginError('Network error or server unavailable');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const startScanner = async () => {
    setView('scanner');
    setTimeout(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } 
            });
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
          } catch (err) {
            alert('Camera access denied');
            setView('main');
          }
    }, 100);
  };

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        
        // Preprocess
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const contrast = 1.2;
          const val = ((avg - 128) * contrast) + 128;
          data[i] = data[i+1] = data[i+2] = Math.max(0, Math.min(255, val));
        }
        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) {
            setCurrentBlob(blob);
            setCurrentCapture(URL.createObjectURL(blob));
            setView('edit');
            processOCR(blob);
            stopScanner();
          }
        }, 'image/jpeg', 0.9);
      }
    }
  };

  const stopScanner = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
    }
  };

  const processOCR = async (blob: Blob) => {
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('image', blob);

    try {
      const res = await fetch('/api/ocr-process', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.structuredData) {
        setFormData({
            ticket_number: data.structuredData.ticket_number || '',
            name: data.structuredData.name || '',
            nic: data.structuredData.nic || '',
            item_description: data.structuredData.item_description || '',
            weight: data.structuredData.weight || '',
            loan_amount: data.structuredData.loan_amount || '',
            interest_rate: data.structuredData.interest_rate || '',
            type: data.structuredData.type === 'RECEIPT' ? 'RECEIPT' : 'TICKET'
        });
      }
    } catch (err) {
      console.error('OCR/AI error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!formData.ticket_number) return;
    
    const fd = new FormData();
    if (currentBlob) fd.append('image', currentBlob);
    fd.append('recordData', JSON.stringify(formData));

    try {
      const res = await fetch('/api/save-record', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const result = await res.json();
      if (res.ok) {
        setView('main');
        loadRecords();
      } else {
        console.error(result.error);
      }
    } catch (err) {
      console.error('Save failed');
    }
  };

  const downloadCSV = () => {
    if (records.length === 0) return alert('No records to export');
    
    const headers = ['Ticket Number', 'Status', 'Name', 'NIC', 'Description', 'Weight', 'Loan Amount (Rs)', 'Interest Rate (%)', 'Date'];
    const rows = records.map(reg => [
      reg.ticket_number,
      getStatus(reg),
      `"${reg.name || ''}"`,
      reg.nic || '',
      `"${reg.item_description || ''}"`,
      reg.weight || '',
      reg.loan_amount,
      reg.interest_rate,
      new Date(reg.created_at).toLocaleDateString()
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Pawn_Records_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (view === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
            <div className="flex flex-col items-center mb-8">
                <div className="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center text-white mb-4">
                    <ScanLine className="w-10 h-10" />
                </div>
                <h1 className="text-2xl font-bold">AI Scanner</h1>
                <p className="text-slate-500">Pawn Management System</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
                {loginError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 flex items-center gap-2">
                        <X className="w-4 h-4" />
                        {loginError}
                    </motion.div>
                )}
                <div>
                    <label className="block text-sm font-medium mb-1">Staff Username</label>
                    <input name="username" type="text" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <div>
                    <label className="block text-sm font-medium mb-1">Access Password</label>
                    <input name="password" type="password" className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
                </div>
                <button 
                  type="submit" 
                  disabled={isLoggingIn}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    {isLoggingIn && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isLoggingIn ? 'Verifying Access...' : 'Login to Branch'}
                </button>
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs text-blue-700 font-medium mb-1">Demo Credentials:</p>
                    <p className="text-xs text-blue-600">Username: <span className="font-bold">admin</span></p>
                    <p className="text-xs text-blue-600">Password: <span className="font-bold">admin123</span></p>
                </div>
            </form>
        </motion.div>
      </div>
    );
  }

function getStatus(reg: Record) {
    if (reg.status === 'REDEEMED') return 'REDEEMED';
    const createdDate = new Date(reg.created_at);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    if (createdDate < threeMonthsAgo) return 'OVERDUE';
    return 'ACTIVE';
  }

  const renderStatus = (reg: Record) => {
    const status = getStatus(reg);
    const colors = {
      REDEEMED: 'bg-emerald-100 text-emerald-700',
      OVERDUE: 'bg-rose-100 text-rose-700',
      ACTIVE: 'bg-blue-100 text-blue-700'
    };
    return (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[status]}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white">
                <ScanLine className="w-6 h-6" />
            </div>
            <div>
                <h2 className="font-bold leading-none">AI Scanner</h2>
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    {user?.role} | {user?.branch_name || 'Admin'}
                </span>
            </div>
        </div>
        
        <div className="flex items-center gap-4">
            <button onClick={startScanner} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-lg">
                <Camera className="w-4 h-4" />
                Scan Document
            </button>
            <button onClick={() => { localStorage.clear(); setView('login'); }} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                <LogOut className="w-5 h-5" />
            </button>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-5xl mx-auto w-full">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center mb-8">
                <div className="flex-1 min-w-[300px] relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search Ticket #, Name, or NIC..." 
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {user?.role === 'Admin' && (
                  <select 
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="px-4 py-2 border border-slate-200 rounded-lg outline-none bg-white text-sm"
                  >
                    <option value="">All Branches</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                )}
                <button 
                  onClick={downloadCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition text-sm font-medium"
                >
                  <Download className="w-4 h-4" />
                  Download CSV
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-semibold">Recent Transactions</h3>
                    <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-1 rounded">{records.length} Records</span>
                </div>
                <div className="bg-slate-100 py-2 px-4 grid grid-cols-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                    <div>Ticket #</div>
                    <div>Name</div>
                    <div>NIC</div>
                    <div>Loan (Rs.)</div>
                    <div>Date</div>
                </div>
                <div className="divide-y divide-slate-100">
                    {records.map(reg => (
                        <div key={reg.id} className="grid grid-cols-5 items-center px-4 py-3 hover:bg-slate-50 transition cursor-pointer text-sm">
                            <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-blue-700">{reg.ticket_number}</span>
                                {renderStatus(reg)}
                            </div>
                            <div className="font-medium">{reg.name || '---'}</div>
                            <div className="text-slate-500 font-mono">{reg.nic || '---'}</div>
                            <div className="font-bold">Rs. {reg.loan_amount.toLocaleString()}</div>
                            <div className="text-slate-400 text-xs">{new Date(reg.created_at).toLocaleDateString()}</div>
                        </div>
                    ))}
                    {records.length === 0 && <div className="p-8 text-center text-slate-400">No records found.</div>}
                </div>
            </div>
        </div>
      </main>

      <AnimatePresence>
        {view === 'scanner' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col p-4">
             <div className="flex items-center justify-between mb-4 text-white">
                <h3 className="text-xl font-bold">Document Capture</h3>
                <button onClick={() => { stopScanner(); setView('main'); }} className="p-2 hover:bg-white/10 rounded-full"><X /></button>
            </div>
            <div className="flex-1 relative bg-black rounded-xl overflow-hidden shadow-2xl flex items-center justify-center">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />
                <div className="absolute inset-0 border-2 border-dashed border-white/30 rounded-xl pointer-events-none m-8 flex items-center justify-center">
                    <div className="text-white/30 text-xs text-center">POSITION DOCUMENT WITHIN FRAME</div>
                </div>
                <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="py-6 flex items-center justify-center">
                <button onClick={capture} className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-slate-900 border-8 border-slate-300 shadow-2xl hover:scale-105 transition active:scale-95">
                    <Camera className="w-10 h-10" />
                </button>
            </div>
          </motion.div>
        )}

        {view === 'edit' && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} className="fixed inset-0 z-50 bg-slate-100 flex flex-col">
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => setView('scanner')} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft /></button>
                    <h3 className="text-lg font-bold">Verification & Digitization</h3>
                </div>
                {isProcessing ? (
                  <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      AI Analysis...
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium font-bold">
                      <CheckCircle className="w-4 h-4" /> Ready to Save
                  </div>
                )}
                <button 
                  onClick={handleSave} 
                  disabled={isProcessing}
                  className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-bold disabled:opacity-50 shadow-lg"
                >
                    Finalize Entry
                </button>
            </div>

            <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2">
                <div className="bg-slate-900 p-8 flex items-center justify-center overflow-auto">
                    <img src={currentCapture || ''} alt="Preview" className="max-w-full shadow-2xl rounded" />
                </div>

                <div className="bg-white p-8 overflow-auto border-l border-slate-200">
                    <div className="max-w-xl mx-auto space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ticket Number</label>
                                <input 
                                  value={formData.ticket_number} 
                                  onChange={e => setFormData({...formData, ticket_number: e.target.value})} 
                                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none font-mono text-lg focus:ring-2 focus:ring-blue-500" 
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                                <select 
                                  value={formData.type} 
                                  onChange={e => setFormData({...formData, type: e.target.value as any})}
                                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none font-bold text-blue-600 bg-white"
                                >
                                    <option value="TICKET">PAWN TICKET (New)</option>
                                    <option value="RECEIPT">RECEIPT (Redeem)</option>
                                </select>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Customer Full Name</label>
                            <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">NIC Number</label>
                            <input value={formData.nic} onChange={e => setFormData({...formData, nic: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none font-mono focus:ring-2 focus:ring-blue-500" />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Item Description</label>
                            <input value={formData.item_description} onChange={e => setFormData({...formData, item_description: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Weight</label>
                                <input value={formData.weight} onChange={e => setFormData({...formData, weight: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Loan Amount</label>
                                <input type="number" value={formData.loan_amount} onChange={e => setFormData({...formData, loan_amount: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none font-bold text-blue-700 focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Interest %</label>
                                <input type="number" step="0.1" value={formData.interest_rate} onChange={e => setFormData({...formData, interest_rate: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
