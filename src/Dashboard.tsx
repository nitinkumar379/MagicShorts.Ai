import React, { useState, useEffect, useRef } from 'react';
import { Plus, Video, Calendar, CheckCircle, AlertCircle, Loader2, Youtube, LogOut, Trash2, Upload, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from './contexts/AuthContext';
import { signInWithGoogle, logout, db, collection, addDoc, query, where, onSnapshot, serverTimestamp, orderBy, deleteDoc, doc, updateDoc } from './lib/firebase';
import { detectHighlights } from './lib/gemini';

const Dashboard = () => {
  const { user } = useAuth();
  const [url, setUrl] = useState('');
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // YouTube OAuth
  const [ytLinked, setYtLinked] = useState(false);

  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === 'YOUTUBE_AUTH_SUCCESS') {
        setYtLinked(true);
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  useEffect(() => {
    if (!user) return;
    const primaryDoc = doc(db, 'users', user.uid, 'youtubeAccounts', 'primary');
    return onSnapshot(primaryDoc, (snap) => {
      setYtLinked(snap.exists());
    });
  }, [user]);

  const connectYouTube = async () => {
    if (!user) return;
    const res = await fetch(`/api/auth/youtube/url?userId=${user.uid}`);
    const { url } = await res.json();
    window.open(url, 'yt_auth', 'width=600,height=700');
  };

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'videos'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    return onSnapshot(q, (snapshot) => {
      setVideos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
  }, [user]);

  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !user) return;
    setLoading(true);
    try {
      // 1. Get metadata from server
      const infoRes = await fetch(`/api/video-info?url=${encodeURIComponent(url)}`);
      if (!infoRes.ok) throw new Error('Failed to fetch video info');
      const info = await infoRes.json();

      // 2. Analyze metadata using Gemini
      const analysis = await detectHighlights(info.title, info.description);
      
      const docRef = await addDoc(collection(db, 'videos'), {
        userId: user.uid,
        sourceUrl: url,
        title: analysis.suggestedTitle || info.title,
        startTime: analysis.startTime || 0,
        status: 'downloading',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      await fetch('/api/process-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          videoUrl: url, 
          userId: user.uid, 
          videoId: docRef.id,
          startTime: analysis.startTime 
        })
      });

      setUrl('');
      setIsAdding(false);
    } catch (err) {
      console.error(err);
      alert('Error adding video. Check URL or try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('video', file);
    formData.append('userId', user.uid);

    try {
      const res = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setIsAdding(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async (video: any) => {
    if (!ytLinked) {
      alert('Please connect YouTube first');
      return;
    }
    setLoading(true);
    try {
      await fetch('/api/youtube/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          userId: user.uid,
          metadata: { title: video.title, description: '#shorts #magicai' }
        })
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this project?')) {
      await deleteDoc(doc(db, 'videos', id));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'scheduled': return <Calendar className="w-5 h-5 text-blue-500" />;
      case 'uploading': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default: return <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />;
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-12 bg-brand-surface rounded-[2rem] shadow-2xl text-center max-w-md w-full border border-zinc-800"
        >
          <div className="w-20 h-20 bg-indigo-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner">
            <Youtube className="w-10 h-10 text-brand-primary" />
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tight text-white italic">ShortsMagic AI</h1>
          <p className="text-zinc-400 mb-10 leading-relaxed font-medium">Turn any long video into viral YouTube Shorts in seconds using AI.</p>
          <button
            onClick={signInWithGoogle}
            className="w-full py-5 px-6 bg-brand-primary text-white rounded-[1.25rem] font-bold hover:bg-brand-indigo-dark transition-all hover:scale-[1.02] flex items-center justify-center gap-4 text-lg shadow-xl shadow-indigo-500/20"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/layout/google.svg" className="w-6 h-6 bg-white rounded-full p-0.5" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg text-zinc-100 font-sans flex overflow-hidden">
      {/* Sidebar - Mapping navigation here to match theme layout pattern */}
      <nav className="w-72 bg-brand-surface border-r border-zinc-800 flex flex-col p-8 hidden lg:flex">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 bg-brand-primary rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Video className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-black tracking-tighter text-white">MAGIC.AI</span>
        </div>
        
        <div className="space-y-4 mb-auto">
          <div className="flex items-center gap-3 px-4 py-3 bg-brand-primary/10 text-brand-primary rounded-xl border border-brand-primary/20">
             <Plus className="w-5 h-5" />
             <span className="font-bold">Dashboard</span>
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 rounded-xl transition-all"
          >
            <Upload className="w-5 h-5" />
            <span className="font-semibold text-sm">New Clip</span>
          </button>
          
          <div className="pt-4 mt-4 border-t border-zinc-800">
             <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-black mb-4">Accounts</p>
             {!ytLinked ? (
                <button onClick={connectYouTube} className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 rounded-xl transition-all text-sm font-semibold">
                  <Youtube className="w-4 h-4 text-brand-primary" />
                  Link YouTube
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2 bg-green-500/5 text-green-500 rounded-xl border border-green-500/10 text-xs font-bold">
                  <CheckCircle className="w-4 h-4" />
                  YouTube Connected
                </div>
              )}
          </div>
        </div>

        <div className="mt-auto pt-8 border-t border-zinc-800">
           <div className="flex items-center gap-3 bg-brand-surface-highlight p-4 rounded-2xl border border-zinc-800 shadow-sm transition-all hover:border-zinc-700">
              <img src={user.photoURL || ''} className="w-10 h-10 rounded-full border-2 border-zinc-700 shadow-sm" alt="" referrerPolicy="no-referrer" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate text-white">{user.displayName}</p>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Free Plan</p>
              </div>
              <button onClick={logout} className="p-2 text-zinc-500 hover:text-red-500 transition-colors">
                 <LogOut className="w-4 h-4" />
              </button>
           </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative h-screen overflow-y-auto">
        {/* Mobile Nav Header */}
        <div className="lg:hidden fixed top-0 w-full z-40 bg-brand-surface/80 backdrop-blur-xl border-b border-zinc-800 px-6 py-4 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="bg-brand-primary p-2 rounded-xl">
                <Video className="w-5 h-5 text-white" />
              </div>
              <span className="font-black text-xl tracking-tighter">MAGIC.AI</span>
            </div>
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-zinc-700" alt="" referrerPolicy="no-referrer" />
        </div>

        <div className="max-w-6xl w-full mx-auto px-8 pt-24 lg:pt-16 pb-24">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-brand-primary mb-3">Automation Hub</p>
              <h2 className="text-4xl font-black mb-2 tracking-tighter text-white">Your Studio</h2>
              <p className="text-zinc-500 text-sm font-medium">Manage clips, AI processing, and viral schedules.</p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setIsAdding(true)}
                className="flex items-center gap-3 bg-white text-black px-6 py-4 rounded-xl font-bold hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Produce Magic
              </button>
            </div>
          </header>

          {/* Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 italic">
             <div className="bg-brand-surface border border-zinc-800 p-6 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black mb-2">Processing</p>
                <p className="text-2xl font-mono font-bold text-brand-primary">{videos.filter(v => v.status !== 'completed' && v.status !== 'failed').length}</p>
             </div>
             <div className="bg-brand-surface border border-zinc-800 p-6 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black mb-2">Total Shorts</p>
                <p className="text-2xl font-mono font-bold text-white">{videos.length}</p>
             </div>
             <div className="bg-brand-surface border border-zinc-800 p-6 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black mb-2">Success Rate</p>
                <p className="text-2xl font-mono font-bold text-green-500">100%</p>
             </div>
          </div>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AnimatePresence mode="popLayout">
              {videos.map((video) => (
                <motion.div
                  key={video.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-brand-surface border border-zinc-800 p-6 rounded-2xl hover:border-zinc-700 transition-all group relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="bg-zinc-900 border border-zinc-800 w-12 h-16 rounded-lg flex items-center justify-center text-[10px] text-zinc-600 font-black uppercase group-hover:bg-zinc-800 transition-colors">
                      9:16
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${
                      video.status === 'completed' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 
                      video.status === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 
                      'bg-indigo-500/10 text-brand-primary border-brand-primary/20'
                    }`}>
                      {getStatusIcon(video.status)}
                      {video.status}
                    </div>
                  </div>
                  
                  <div className="mb-8">
                    <h3 className="font-bold text-lg mb-1 line-clamp-1 text-white group-hover:text-brand-primary transition-colors">{video.title}</h3>
                    <p className="text-xs text-zinc-500 truncate font-mono">{video.sourceUrl || 'Manual Upload'}</p>
                    
                    {video.status !== 'completed' && video.status !== 'failed' && (
                       <div className="mt-4 flex items-center gap-3">
                          <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                             <motion.div 
                               initial={{ width: 0 }}
                               animate={{ width: video.status === 'downloading' ? '30%' : video.status === 'editing' ? '60%' : '90%' }}
                               className="h-full bg-brand-primary"
                             />
                          </div>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {video.status === 'downloading' ? '30%' : video.status === 'editing' ? '60%' : '90%'}
                          </span>
                       </div>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between pt-6 border-t border-zinc-800/50">
                    <div className="flex items-center gap-3">
                      {video.status === 'scheduled' && (
                        <button
                          onClick={() => handlePublish(video)}
                          disabled={loading}
                          className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-xl text-xs font-black hover:bg-zinc-200 transition-all shadow-lg active:scale-95"
                        >
                          <Send className="w-3 h-3" />
                          Publish
                        </button>
                      )}
                      {video.status === 'completed' && (
                        <div className="flex items-center gap-2 text-green-500 text-[10px] font-black uppercase tracking-widest">
                           <CheckCircle className="w-3 h-3" />
                           Live on YT
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4">
                       <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest border-r border-zinc-800 pr-4">
                          {video.createdAt?.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                       </span>
                       <button onClick={() => handleDelete(video.id)} className="p-1.5 text-zinc-700 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            
            {videos.length === 0 && !loading && (
               <div className="col-span-full py-24 text-center bg-brand-surface border border-zinc-800 rounded-3xl">
                  <div className="bg-zinc-900 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-zinc-800">
                    <Video className="w-8 h-8 text-zinc-700" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-white">No projects yet</h3>
                  <p className="text-zinc-500 text-sm font-medium max-w-xs mx-auto">Build your library. Upload a video or paste a link to start processing.</p>
               </div>
            )}
          </section>
        </div>
      </main>

      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-brand-surface w-full max-w-lg rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] p-10 overflow-hidden border border-zinc-800"
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-primary" />
              
              <h2 className="text-3xl font-black mb-8 tracking-tighter text-white">Produce Masterpiece</h2>
              
              <div className="space-y-8">
                <form onSubmit={handleAddVideo} className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] mb-3 text-zinc-500">YouTube Source URL</label>
                    <div className="relative group">
                      <input
                        type="url"
                        placeholder="https://youtube.com/watch?v=..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        className="w-full px-6 py-4 bg-zinc-900 border border-zinc-800 rounded-2xl focus:border-brand-primary outline-none font-bold text-sm transition-all text-white placeholder:text-zinc-700"
                      />
                      <button 
                        type="submit" 
                        disabled={loading || !url}
                        className="absolute right-2 top-2 bottom-2 aspect-square bg-white hover:bg-zinc-200 text-black rounded-xl flex items-center justify-center transition-all disabled:opacity-0 active:scale-90 shadow-sm"
                      >
                       <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </form>

                <div className="relative flex items-center justify-center">
                  <div className="absolute w-full h-[1px] bg-zinc-800" />
                  <span className="relative bg-brand-surface px-4 text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Or direct upload</span>
                </div>

                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="group cursor-pointer py-10 border border-zinc-800 bg-zinc-900/30 rounded-[1.5rem] hover:border-brand-primary/40 hover:bg-zinc-800/50 transition-all text-center border-dashed"
                >
                  <Upload className="w-10 h-10 text-zinc-700 mx-auto mb-4 group-hover:text-brand-primary transition-all group-hover:scale-110" />
                  <span className="block font-black text-zinc-600 group-hover:text-zinc-400 transition-colors uppercase tracking-[0.2em] text-[10px]">Select Video File</span>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="video/*" />
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="fixed bottom-8 right-8 z-50">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-brand-primary text-white px-6 py-4 rounded-2xl flex items-center gap-4 shadow-2xl shadow-indigo-500/30 font-black border border-white/10"
          >
            <Loader2 className="w-5 h-5 animate-spin text-white" />
            AI AT WORK...
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
