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
  Download,
  Menu,
  LayoutDashboard,
  Image as ImageIcon,
  FileSpreadsheet,
  Upload
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
  const [view, setView] = useState<'login' | 'dashboard' | 'scanner' | 'upload' | 'edit' | 'cloudinary' | 'sheets'>('login');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [branches, setBranches] = useState<{id: number, name: string}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [currentCapture, setCurrentCapture] = useState<string | null>(null);
  const [currentBlob, setCurrentBlob] = useState<Blob | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    ticket_number: '',
    name: '',
    nic: '',
    item_description: '',
    weight: '',
    loan_amount: '',
    interest_rate: '',
    raw_ocr_text: '',
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
      setView('dashboard');
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
        setView('dashboard');
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
            setView('dashboard');
          }
    }, 100);
  };

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Use higher quality capture
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        
        // Advanced Preprocessing for OCR
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          // Grayscale + Contrast
          const threshold = 120;
          const val = avg > threshold ? 255 : 0;
          data[i] = data[i+1] = data[i+2] = val;
        }
        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) {
            console.log(`Captured Image: ${blob.size} bytes`);
            setCurrentBlob(blob);
            setCurrentCapture(URL.createObjectURL(blob));
            setView('edit');
            processOCR(blob);
            stopScanner();
          }
        }, 'image/jpeg', 0.95);
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
            raw_ocr_text: data.rawText || '',
            type: data.structuredData.type === 'RECEIPT' ? 'RECEIPT' : 'TICKET'
        });
        console.log('OCR completed and structured');
      }
    } catch (err) {
      console.error('OCR/AI error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCurrentBlob(file);
      setCurrentCapture(URL.createObjectURL(file));
      setView('edit');
      processOCR(file);
    }
  };

  const handleSave = async () => {
    if (!formData.ticket_number) {
        setSaveError('Ticket number is required');
        return;
    }
    setSaveError(null);
    setIsProcessing(true);
    
    console.log('Finalizing entry for:', formData.ticket_number);
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
        alert("PROCESS COMPLETE\n" + result.message);
        setView('dashboard');
        loadRecords();
      } else {
        setSaveError(result.error || 'Save failed');
      }
    } catch (err) {
      setSaveError('Network error or server unavailable');
    } finally {
      setIsProcessing(false);
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

  const renderSidebar = () => {
    const menuItems = [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'scanner', label: 'Scan Document', icon: Camera },
      { id: 'upload', label: 'Upload Document', icon: Upload },
      { id: 'cloudinary', label: 'Cloudinary Files', icon: ImageIcon },
      { id: 'sheets', label: 'Excel / Sheets', icon: FileSpreadsheet },
    ];

    return (
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 260 : 80 }}
        className="bg-slate-900 text-white h-screen fixed left-0 top-0 z-30 transition-all duration-300 flex flex-col shadow-2xl"
      >
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          {isSidebarOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <ScanLine className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg">AI Scanner</span>
            </motion.div>
          )}
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-white/10 rounded-lg">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'scanner') startScanner();
                  else if (item.id === 'upload') setView('upload');
                  else setView(item.id as any);
                }}
                className={`w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200 group ${
                  isActive ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-white/5 text-slate-400'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'group-hover:text-white'}`} />
                {isSidebarOpen && <span className="font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
            <button 
              onClick={() => { localStorage.clear(); setView('login'); }}
              className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
            >
                <LogOut className="w-5 h-5" />
                {isSidebarOpen && <span className="font-medium">Logout</span>}
            </button>
            {isSidebarOpen && user && (
              <div className="mt-4 p-3 bg-white/5 rounded-xl">
                 <p className="text-[11px] uppercase font-bold text-slate-500 mb-1">Authenticated As</p>
                 <p className="text-sm font-semibold truncate">{user.username}</p>
                 <p className="text-xs text-slate-400 truncate">{user.branch_name || 'Admin'}</p>
              </div>
            )}
        </div>
      </motion.aside>
    );
  };

  const renderStatus = (reg: Record) => {
    const status = getStatus(reg);
    const colors = {
      REDEEMED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      OVERDUE: 'bg-rose-100 text-rose-700 border-rose-200',
      ACTIVE: 'bg-blue-100 text-blue-700 border-blue-200'
    };
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colors[status]}`}>
        {status}
      </span>
    );
  };

  function getStatus(reg: Record) {
    if (reg.status === 'REDEEMED') return 'REDEEMED';
    const createdDate = new Date(reg.created_at);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    if (createdDate < threeMonthsAgo) return 'OVERDUE';
    return 'ACTIVE';
  }

  const renderDashboard = () => (
    <div className="max-w-6xl mx-auto w-full space-y-8">
        <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-slate-800 transition-all">Dashboard</h1>
            <div className="flex gap-2">
                <button onClick={startScanner} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg hover:bg-blue-700 transition flex items-center gap-2">
                    <Camera className="w-5 h-5" />
                    New Scan
                </button>
            </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-4 items-center">
            <div className="flex-1 min-w-[300px] relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search by Ticket #, Name, or NIC..." 
                  className="w-full pl-12 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            {user?.role === 'Admin' && (
              <select 
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="px-4 py-3 border border-slate-200 rounded-xl outline-none bg-white text-sm font-medium"
              >
                <option value="">All Branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button 
              onClick={downloadCSV}
              className="flex items-center gap-2 px-6 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition font-bold"
            >
              <Download className="w-5 h-5" />
              Export CSV
            </button>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ticket / Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Customer</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Loan Amount</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {records.map(reg => (
                            <tr key={reg.id} className="hover:bg-slate-50 transition cursor-pointer group">
                                <td className="px-6 py-4">
                                    <div className="flex flex-col gap-1">
                                        <span className="font-mono font-bold text-blue-700 text-lg group-hover:scale-105 transition-transform origin-left inline-block">#{reg.ticket_number}</span>
                                        <div>{renderStatus(reg)}</div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="font-semibold text-slate-700">{reg.name || '---'}</div>
                                    <div className="text-xs text-slate-400 font-mono">{reg.nic || '---'}</div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <span className="bg-blue-50 text-blue-800 font-bold px-3 py-1 rounded-lg">
                                        Rs. {reg.loan_amount.toLocaleString()}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-slate-400 text-xs font-medium">
                                    {new Date(reg.created_at).toLocaleDateString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {records.length === 0 && (
                    <div className="p-20 text-center flex flex-col items-center gap-4">
                        <Search className="w-12 h-12 text-slate-200" />
                        <p className="text-slate-400 font-medium">No records found matching your criteria</p>
                    </div>
                )}
            </div>
        </div>
    </div>
  );

  const renderUpload = () => (
    <div className="max-w-2xl mx-auto py-12">
        <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-slate-800 mb-4">Upload Document</h1>
            <p className="text-slate-500 text-lg">Select a JPG or PNG image of a pawn ticket or receipt to process it with AI.</p>
        </div>
        
        <div className="bg-white p-12 rounded-3xl border-4 border-dashed border-slate-200 flex flex-col items-center justify-center gap-6 hover:border-blue-400 transition-colors group relative overflow-hidden shadow-sm">
            <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                <Upload className="w-12 h-12" />
            </div>
            <div className="text-center">
                <p className="text-xl font-bold text-slate-700">Drag and drop file here</p>
                <p className="text-slate-400">or click to browse your computer</p>
            </div>
            <input 
              type="file" 
              className="absolute inset-0 opacity-0 cursor-pointer" 
              accept="image/*"
              onChange={handleUpload}
            />
        </div>
    </div>
  );

  const renderViewer = (title: string, message: string, icon: any) => {
    const Icon = icon;
    return (
      <div className="max-w-4xl mx-auto py-20 px-8">
          <div className="bg-white rounded-[2.5rem] p-12 shadow-2xl border border-slate-100 flex flex-col items-center text-center gap-8">
              <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center text-blue-600 shadow-inner">
                  <Icon className="w-12 h-12" />
              </div>
              <div>
                  <h2 className="text-4xl font-black text-slate-800 mb-4 tracking-tight">{title}</h2>
                  <p className="text-slate-500 text-lg max-w-lg mx-auto font-medium">{message}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-md">
                 <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-2">Integration Status</p>
                    <p className="text-emerald-600 font-black flex items-center justify-center gap-2">
                       <CheckCircle className="w-4 h-4" /> Connected
                    </p>
                 </div>
                 <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-2">Active Branch</p>
                    <p className="text-slate-700 font-black">{user?.branch_name || 'Main Office'}</p>
                 </div>
              </div>
              <button 
                onClick={() => setView('dashboard')}
                className="mt-4 px-8 py-4 bg-slate-800 text-white rounded-2xl font-bold hover:bg-slate-900 transition-all flex items-center gap-3 active:scale-95"
              >
                  <ArrowLeft className="w-5 h-5" /> Return to Dashboard
              </button>
          </div>
      </div>
    );
  };

  const mainContent = () => {
      switch(view) {
          case 'dashboard': return renderDashboard();
          case 'upload': return renderUpload();
          case 'cloudinary': return renderViewer('Digital Asset Vault', 'Accessing stored ticket images on Cloudinary high-performance storage.', ImageIcon);
          case 'sheets': return renderViewer('Google Sheets Sync', 'Real-time database synchronization with central management spreadsheet.', FileSpreadsheet);
          case 'edit': return null; // Logic is outside mainContent for overlay effect
          default: return renderDashboard();
      }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 overflow-hidden">
      {renderSidebar()}

      <div className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'ml-[260px]' : 'ml-[80px]'}`}>
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
          <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold text-slate-800 capitalize tracking-tight">{view}</h2>
          </div>
          
          <div className="flex items-center gap-4 text-slate-500">
              <div className="hidden md:flex flex-col items-end mr-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{user?.branch_name || 'Main Office'}</span>
                  <span className="text-sm font-semibold text-slate-700">{user?.role} Access</span>
              </div>
          </div>
        </header>

        <main className="flex-1 p-10 overflow-auto">
            {mainContent()}
        </main>
      </div>

      <AnimatePresence>
        {view === 'scanner' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-slate-900/95 flex flex-col p-4 backdrop-blur-md">
             <div className="flex items-center justify-between mb-4 text-white px-4">
                <div className="flex items-center gap-3">
                   <Camera className="text-blue-500" />
                   <h3 className="text-xl font-bold">Document Capture</h3>
                </div>
                <button onClick={() => { stopScanner(); setView('dashboard'); }} className="p-2 hover:bg-white/10 rounded-full border border-white/20 transition-colors"><X /></button>
            </div>
            <div className="flex-1 relative bg-black rounded-[2rem] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)] flex items-center justify-center m-4">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain" />
                <div className="absolute inset-0 border-4 border-dashed border-white/20 rounded-[2rem] pointer-events-none m-12 flex items-center justify-center">
                    <div className="bg-white/10 backdrop-blur-md text-white/80 px-6 py-2 rounded-full font-bold text-sm border border-white/10">POSITION DOCUMENT WITHIN FRAME</div>
                </div>
                <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="py-10 flex items-center justify-center">
                <button onClick={capture} className="group relative w-24 h-24">
                    <div className="absolute inset-0 bg-blue-600 rounded-full animate-ping opacity-25"></div>
                    <div className="relative w-full h-full bg-white rounded-full flex items-center justify-center text-blue-600 border-8 border-slate-200 shadow-2xl active:scale-90 transition-transform group-hover:scale-105">
                        <Camera className="w-12 h-12" />
                    </div>
                </button>
            </div>
          </motion.div>
        )}

        {view === 'edit' && (
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed inset-0 z-50 bg-slate-50 flex flex-col">
            <div className="bg-white border-b border-slate-200 px-8 py-5 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-6">
                    <button onClick={() => setView('dashboard')} className="p-3 hover:bg-slate-100 rounded-2xl transition-colors"><ArrowLeft className="w-6 h-6 text-slate-600" /></button>
                    <div>
                        <h3 className="text-2xl font-bold text-slate-800 tracking-tight">AI Data Extraction</h3>
                        <p className="text-sm text-slate-500 font-medium">Verified by Gemini AI Scanner</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-6">
                    {isProcessing ? (
                      <div className="flex items-center gap-3 px-5 py-2.5 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100 font-bold animate-pulse">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Running AI Analysis...
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-5 py-2.5 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100 font-bold">
                          <CheckCircle className="w-5 h-5" /> All Data Extracted
                      </div>
                    )}
                    <button 
                      onClick={handleSave} 
                      disabled={isProcessing}
                      className="px-10 py-3.5 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-black disabled:opacity-50 shadow-xl shadow-emerald-200 active:scale-95"
                    >
                        PROCESS & SAVE
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2">
                <div className="bg-slate-900 p-12 flex items-center justify-center overflow-auto">
                    <div className="relative group">
                        <img src={currentCapture || ''} alt="Preview" className="max-w-full shadow-[0_0_150px_rgba(37,99,235,0.2)] rounded-2xl border border-white/10" />
                    </div>
                </div>

                <div className="bg-white p-12 overflow-auto border-l border-slate-200">
                    <div className="max-w-xl mx-auto space-y-8">
                        {saveError && (
                            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-rose-50 border-2 border-rose-100 rounded-2xl text-rose-600 text-sm flex items-center gap-4">
                                <X className="w-8 h-8 bg-rose-100 rounded-xl p-2" />
                                <div className="font-black">{saveError}</div>
                            </motion.div>
                        )}
                        
                        <div className="flex justify-center">
                            <div className="inline-flex gap-1 p-1.5 bg-slate-100 rounded-2xl overflow-hidden font-bold">
                                <button 
                                  onClick={() => setFormData({...formData, type: 'TICKET'})}
                                  className={`px-8 py-3 rounded-xl transition-all ${formData.type === 'TICKET' ? 'bg-white shadow-lg text-blue-600 scale-105' : 'text-slate-400'}`}
                                >PAWN TICKET</button>
                                <button 
                                  onClick={() => setFormData({...formData, type: 'RECEIPT'})}
                                  className={`px-8 py-3 rounded-xl transition-all ${formData.type === 'RECEIPT' ? 'bg-white shadow-lg text-emerald-600 scale-105' : 'text-slate-400'}`}
                                >RECEIPT</button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Receipt Number</label>
                                <input 
                                  value={formData.ticket_number} 
                                  onChange={e => setFormData({...formData, ticket_number: e.target.value})} 
                                  className="w-full px-6 py-4 border-2 border-slate-100 rounded-2xl outline-none font-mono text-3xl font-black text-blue-600 focus:border-blue-400 transition-all bg-slate-50 shadow-inner" 
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Weight (g)</label>
                                <input value={formData.weight} onChange={e => setFormData({...formData, weight: e.target.value})} className="w-full px-6 py-4 border-2 border-slate-100 rounded-2xl outline-none text-2xl font-bold focus:border-blue-400 transition-all bg-slate-50" />
                            </div>
                        </div>
                        
                        <div className="space-y-2">
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Customer Name</label>
                            <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-6 py-5 border-2 border-slate-100 rounded-2xl outline-none text-xl font-bold focus:border-blue-400 transition-all bg-slate-50" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">NIC Number</label>
                                <input value={formData.nic} onChange={e => setFormData({...formData, nic: e.target.value})} className="w-full px-6 py-4 border-2 border-slate-100 rounded-2xl outline-none font-mono text-xl font-bold focus:border-blue-400 transition-all bg-slate-50" />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Loan Amount (Rs)</label>
                                <input type="number" value={formData.loan_amount} onChange={e => setFormData({...formData, loan_amount: e.target.value})} className="w-full px-6 py-4 border-2 border-slate-100 rounded-2xl outline-none font-black text-3xl text-emerald-600 focus:border-emerald-400 transition-all bg-slate-50 shadow-inner" />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                            <div className="space-y-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Interest (%)</label>
                                <input type="number" step="0.1" value={formData.interest_rate} onChange={e => setFormData({...formData, interest_rate: e.target.value})} className="w-full px-6 py-4 border-2 border-slate-100 rounded-2xl outline-none font-bold text-2xl focus:border-blue-400 transition-all bg-slate-50" />
                            </div>
                            <div className="space-y-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Detected Text</label>
                                <div className="px-6 py-4 bg-slate-900 rounded-2xl text-[10px] font-mono text-white/50 h-16 overflow-hidden flex items-center">
                                    {formData.raw_ocr_text.substring(0, 100)}...
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Item Description</label>
                            <textarea rows={3} value={formData.item_description} onChange={e => setFormData({...formData, item_description: e.target.value})} className="w-full px-6 py-5 border-2 border-slate-100 rounded-3xl outline-none font-semibold focus:border-blue-400 transition-all bg-slate-50 resize-none" />
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
