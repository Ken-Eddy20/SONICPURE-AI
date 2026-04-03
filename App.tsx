
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Trash2, 
  Wand2, 
  Play, 
  Pause, 
  Download, 
  Volume2, 
  Mic, 
  AlertCircle,
  Settings2,
  CheckCircle2,
  Coins,
  Activity,
  Headphones, 
  Video, 
  Music, 
  Mic2, 
  Users, 
  Quote, 
  ArrowRight, 
  ListMusic, 
  Waves, 
  Wind, 
  Dog, 
  Coffee, 
  Droplets,
  Sun,
  Moon,
  ChevronDown,
  ChevronUp,
  User as UserIcon,
  LogOut,
  Twitter,
  Github,
  Linkedin,
  Mail
} from 'lucide-react';
import { AudioState, AudioMetadata } from './types';
import { formatBytes, extractAudioFromVideo, getAudioDuration, convertBlobToMp3 } from './services/audioUtils';
import { calculateCreditsForProcessing } from './services/creditsUtils';
import AudioUploader from './components/AudioUploader';
import AuthModal from './components/AuthModal';
import SubscriptionModal from './components/SubscriptionModal';
import { type SubscriptionTier } from './constants/subscriptionPlans';
import PaymentPage from './components/PaymentPage';
import { auth, db } from './firebase';
import { signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';

const NOISE_TYPES = [
  { name: 'Background Audio', icon: <Waves className="w-5 h-5" /> },
  { name: 'Breath & Mouth', icon: <Wind className="w-5 h-5" /> },
  { name: 'Restaurant Chatter', icon: <Coffee className="w-5 h-5" /> },
  { name: 'Dog Barking', icon: <Dog className="w-5 h-5" /> },
  { name: 'Water & Nature', icon: <Droplets className="w-5 h-5" /> },
  { name: 'Background Music', icon: <Music className="w-5 h-5" /> },
];

const STEPS = [
  { title: 'Upload', desc: 'Upload your audio or video files to SonicPure AI in your browser.', icon: <Upload className="w-6 h-6" /> },
  { title: 'Analyze & Clean', desc: 'Select the enhanced content type and our AI will automatically analyze and clean it.', icon: <Wand2 className="w-6 h-6" /> },
  { title: 'Download', desc: 'Download your pristine, noise-free audio files instantly.', icon: <Download className="w-6 h-6" /> },
];

const CREATORS = [
  'Music Producers', 'Podcasters', 'Online Educators', 'Social Media Creators', 'Interviewers', 'Vloggers'
];

const OTHER_TOOLS = [
  'Audio Enhancer', 'Echo Remover', 'Reverb Remover', 'Vocal Remover', 'Drum Remover', 'Podcast Maker'
];

const TESTIMONIALS = [
  { name: 'Sarah J.', role: 'YouTuber', text: 'This voice cleaner is my new BFF. It\'s like noise-canceling headphones for my vids!' },
  { name: 'Mike T.', role: 'Podcaster', text: 'Saved me hours of manual editing. The interface is intuitive and processing is impressively quick.' },
  { name: 'Clara C.', role: 'Vlogger', text: 'My vlog had a lot of café chatter, but this cleaned it up instantly. Crystal clear without losing my voice.' },
  { name: 'David L.', role: 'Musician', text: 'I recorded a demo in my bedroom with the AC running. SonicPure took out the hum completely without touching my guitar tone. Incredible.' },
  { name: 'Emma W.', role: 'Online Educator', text: 'My students used to complain about the background noise in my lectures. Since using this tool, my audio sounds like it was recorded in a professional studio.' },
  { name: 'James K.', role: 'Filmmaker', text: 'Indie filmmaking means dealing with bad location sound. This tool has saved entire scenes that I thought were unusable due to traffic noise.' },
];

const FAQS = [
  { question: 'How does the AI noise reduction work?', answer: 'Our advanced neural networks are trained on thousands of hours of audio to distinguish between human voices and background noise. It isolates the voice and suppresses everything else while preserving the natural tone.' },
  { question: 'What file formats are supported?', answer: 'We support all major audio formats including MP3, WAV, M4A, AAC, and FLAC. Pro and Unlimited users can also upload video files (MP4, WEBM) to extract and clean the audio automatically.' },
  { question: 'Is my audio data secure?', answer: 'Yes, your privacy is our priority. Files are processed securely and are automatically deleted from our servers shortly after processing is complete. We do not use your data to train our models.' },
  { question: 'How long does processing take?', answer: 'Processing time depends on the length of your audio file. Typically, a 5-minute audio clip takes less than 30 seconds to process.' },
  { question: 'Do credits expire?', answer: 'No, credits purchased on the Pay As You Go plan never expire. Monthly subscription credits reset at the beginning of each billing cycle.' },
];

const App: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [user, setUser] = useState<User | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [userTier, setUserTier] = useState<string>('free');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier>('payg');
  const [showPaymentPage, setShowPaymentPage] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // maxIntensity removed for Cleanvoice

  const openSubscriptionModal = (tier: SubscriptionTier) => {
    setSubscriptionTier(tier);
    setShowSubscriptionModal(true);
  };

  const profileMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCheckout = (tier: SubscriptionTier) => {
    setSubscriptionTier(tier);
    setShowPaymentPage(true);
  };
  const audioRef = useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  React.useEffect(() => {
    if (isAuthReady && user) {
      const userRef = doc(db, 'users', user.uid);
      
      const checkAndCreateUser = async () => {
        try {
          const docSnap = await getDoc(userRef);
          if (!docSnap.exists()) {
            let displayName = user.displayName;
            if (!displayName && user.email) {
              displayName = user.email.split('@')[0];
            }

            await setDoc(userRef, {
              email: user.email || '',
              displayName: displayName || 'Anonymous User',
              plan: 'free',
              credits: 50,
              creditsUsedThisMonth: 0,
              dailyEnhancesUsed: 0,
              dailyEnhancesResetAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              billingRenewDate: serverTimestamp(),
              paystackCustomerId: null,
              isActive: true,
            });
          }
        } catch (err) {
          console.error("Error creating user document:", err);
        }
      };
      
      checkAndCreateUser();

      const unsubscribe = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCredits(data.credits ?? 0);
          setUserTier(data.plan || 'free');
        }
      }, (err) => {
        console.error("Firestore Error: ", err);
      });

      return () => unsubscribe();
    } else {
      setCredits(null);
      setUserTier('free');
    }
  }, [user, isAuthReady]);

  const handleSignIn = () => {
    setAuthMode('signin');
    setShowAuthModal(true);
  };

  const handleSignUp = () => {
    setAuthMode('signup');
    setShowAuthModal(true);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  React.useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  // Logic handled by AudioUploader

  if (showPaymentPage) {
    return (
      <PaymentPage
        tier={subscriptionTier}
        onBack={() => setShowPaymentPage(false)}
        userEmail={user?.email ?? undefined}
        onPaymentSuccess={() => setShowPaymentPage(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white selection:bg-indigo-500/30 relative overflow-hidden transition-colors duration-300">
      {/* Background Audio Theme Elements */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden opacity-[0.05] dark:opacity-[0.03]">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" className="text-gray-900 dark:text-white" />
        </svg>
      </div>

      {/* Header */}
      <nav className="sticky top-0 z-50 border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-xl transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <img src="/logo.png" alt="" className="h-12 w-12 object-contain" />
            <span className="font-bold text-xl tracking-tight text-gray-900 dark:text-white">SonicPure <span className="text-indigo-600 dark:text-indigo-400">AI</span></span>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4 text-sm text-gray-600 dark:text-white/60"
          >
            <button 
              onClick={toggleTheme}
              className="p-2.5 rounded-full bg-gray-200 dark:bg-white/5 hover:bg-gray-300 dark:hover:bg-white/10 transition-colors text-gray-700 dark:text-white/70"
              aria-label="Toggle theme"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {user ? (
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-full">
                  <Coins className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-indigo-700 dark:text-indigo-300 font-bold">{credits !== null ? credits : '...'} <span className="font-medium text-xs">credits</span></span>
                </div>
                <div className="relative" ref={profileMenuRef}>
                  <button
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                    className="flex items-center gap-2 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                  >
                    <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}&background=random`} alt="Avatar" className="w-8 h-8 rounded-full border border-gray-200 dark:border-white/10" referrerPolicy="no-referrer" />
                    <ChevronDown className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${showProfileMenu ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {showProfileMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        className="absolute right-0 mt-2 w-56 py-2 rounded-2xl bg-white dark:bg-[#151619] border border-gray-200 dark:border-white/10 shadow-xl z-50 overflow-hidden"
                      >
                        <div className="px-4 py-3 border-b border-gray-200 dark:border-white/10">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{user.displayName || user.email?.split('@')[0] || 'User'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
                        </div>
                        <button
                          onClick={() => { setShowProfileMenu(false); openSubscriptionModal('payg'); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 text-sm"
                        >
                          <Coins className="w-4 h-4 text-indigo-500" />
                          Upgrade / Buy Credits
                        </button>
                        <button
                          onClick={() => { setShowProfileMenu(false); /* Could add account/settings page */ }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 text-sm"
                        >
                          <UserIcon className="w-4 h-4" />
                          Account
                        </button>
                        <button
                          onClick={() => { setShowProfileMenu(false); handleSignOut(); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 text-sm"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <>
                <button onClick={handleSignIn} className="hidden sm:block hover:text-gray-900 dark:hover:text-white transition-colors font-medium">
                  Sign In
                </button>
                <button onClick={handleSignUp} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-all font-medium shadow-lg shadow-indigo-500/20">
                  Create Account
                </button>
              </>
            )}
          </motion.div>
        </div>
      </nav>

      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)} 
        initialMode={authMode} 
      />

      <SubscriptionModal 
        isOpen={showSubscriptionModal} 
        onClose={() => setShowSubscriptionModal(false)} 
        tier={subscriptionTier}
        isAuthenticated={!!user}
        onSignIn={() => { setAuthMode('signin'); setShowAuthModal(true); }}
        onCheckout={handleCheckout}
      />

      <main className="max-w-7xl mx-auto px-6 py-16 relative z-10">
        {/* Clean Grid Background */}
        <div className="absolute inset-0 -z-10 h-full w-full bg-white dark:bg-[#0a0a0a] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
          <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-indigo-500 opacity-20 blur-[100px]"></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Hero & Action Panel */}
          <div className={user ? "lg:col-span-8 space-y-12" : "lg:col-span-12 max-w-4xl mx-auto space-y-12"}>
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={user ? "text-left" : "text-center flex flex-col items-center"}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 text-xs font-semibold uppercase tracking-widest mb-8">
                <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                <span>Professional Audio Processing</span>
              </div>
              <h1 className="text-5xl sm:text-7xl font-bold mb-6 tracking-tight leading-[1.1] text-gray-900 dark:text-white">
                Crystal clear audio.<br />
                <span className="text-gray-400 dark:text-gray-500">Zero background noise.</span>
              </h1>
              <p className={`text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed mb-10 ${!user ? 'mx-auto' : ''}`}>
                Transform your recordings with studio-grade cleanup. SonicPure isolates your voice, eliminates environmental noise, and preserves the natural warmth of your audio in seconds.
              </p>
              
              <div className={`flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400 font-medium ${!user ? 'justify-center' : ''}`}>
                <div className="flex items-center gap-1.5 bg-white dark:bg-white/5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> No credit card required
                </div>
                <div className="flex items-center gap-1.5 bg-white dark:bg-white/5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Free 50 credits
                </div>
                <div className="flex items-center gap-1.5 bg-white dark:bg-white/5 px-3 py-1.5 rounded-full border border-gray-200 dark:border-white/10">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Secure processing
                </div>
              </div>
            </motion.div>

            {/* Action Panel */}
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
              className="bg-white dark:bg-white/[0.02] backdrop-blur-xl rounded-[2.5rem] p-8 sm:p-12 border border-gray-200 dark:border-white/10 shadow-xl shadow-gray-200/50 dark:shadow-2xl dark:shadow-black/50"
            >
              <AudioUploader />
            </motion.div>
      </div>

      {/* Right Column: Features/Tools Panel */}
      {user && (
        <motion.div 
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          className="lg:col-span-4 space-y-6"
        >
          <div className="p-8 rounded-3xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/5 hover:border-indigo-500/30 transition-colors group">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Activity className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h4 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Neural Extraction</h4>
            <p className="text-gray-500 dark:text-white/50 leading-relaxed text-sm">
              Advanced AI models differentiate between foreground vocal signals and complex background environmental noise with surgical precision.
            </p>
          </div>
          <div className="p-8 rounded-3xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/5 hover:border-purple-500/30 transition-colors group">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Volume2 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <h4 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Tone Preservation</h4>
            <p className="text-gray-500 dark:text-white/50 leading-relaxed text-sm">
              Designed specifically to avoid the "robotic" phase artifacts and underwater sounds common in legacy spectral subtractive algorithms.
            </p>
          </div>
          <div className="p-8 rounded-3xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/5 hover:border-pink-500/30 transition-colors group">
            <div className="w-12 h-12 rounded-2xl bg-pink-50 dark:bg-pink-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Settings2 className="w-6 h-6 text-pink-600 dark:text-pink-400" />
            </div>
            <h4 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">Dynamic Intensity</h4>
            <p className="text-gray-500 dark:text-white/50 leading-relaxed text-sm">
              Full control over the processing depth. Choose between light cleanup for ambient feels or heavy isolation for podcast-style clarity.
            </p>
          </div>
        </motion.div>
      )}
    </div>

    {/* Pricing Section */}
    <motion.section 
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="mt-32 mb-16"
    >
      <div className="text-center mb-16">
        <h2 className="text-3xl sm:text-5xl font-bold mb-6">Simple, Transparent Pricing</h2>
        <p className="text-gray-500 dark:text-white/50 text-lg max-w-2xl mx-auto">Start for free, upgrade when you need more power. All plans use our credit-based system.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Free Plan */}
        <div className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 flex flex-col">
          <h3 className="text-2xl font-bold mb-2">Free</h3>
          <p className="text-gray-500 dark:text-white/50 mb-6">Perfect for trying out the service.</p>
          <div className="mb-8">
            <span className="text-5xl font-extrabold">$0</span>
            <span className="text-gray-500 dark:text-white/50">/month</span>
          </div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 50 credits / month</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 2 audio enhance options / day</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 20 mins max audio length</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> Standard processing speed</li>
          </ul>
          <button className="w-full py-4 rounded-2xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-900 dark:text-white font-semibold transition-colors border border-gray-200 dark:border-white/10">
            Current Plan
          </button>
        </div>

        {/* Pay As You Go */}
        <div className="p-8 rounded-[2.5rem] bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 flex flex-col relative">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider rounded-full">
            Most Popular
          </div>
          <h3 className="text-2xl font-bold mb-2">Pay As You Go</h3>
          <p className="text-indigo-800/60 dark:text-indigo-200/60 mb-6">For occasional creators.</p>
          <div className="mb-8">
            <span className="text-5xl font-extrabold">$5</span>
            <span className="text-gray-500 dark:text-white/50">/150 credits</span>
          </div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 150 credits (never expire)</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> Unlimited daily enhances</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 30 mins max audio length</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> High priority processing</li>
          </ul>
          <button 
            onClick={() => openSubscriptionModal('payg')}
            className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors shadow-lg shadow-indigo-500/20"
          >
            Buy Credits
          </button>
        </div>

        {/* Pro Plan */}
        <div className="p-8 rounded-[2.5rem] bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 flex flex-col">
          <h3 className="text-2xl font-bold mb-2">Pro</h3>
          <p className="text-gray-500 dark:text-white/50 mb-6">For professional workflows.</p>
          <div className="mb-8">
            <span className="text-5xl font-extrabold">$20</span>
            <span className="text-gray-500 dark:text-white/50">/month</span>
          </div>
          <ul className="space-y-4 mb-8 flex-1">
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 2500 credits / month</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> Extract audio from video</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> 50 mins max audio length</li>
            <li className="flex items-center gap-3 text-sm"><CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" /> Advanced noise profiles</li>
          </ul>
          <button 
            onClick={() => openSubscriptionModal('pro')}
            className="w-full py-4 rounded-2xl bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-900 dark:text-white font-semibold transition-colors border border-gray-200 dark:border-white/10"
          >
            Subscribe Now
          </button>
        </div>
        
        {/* Unlimited Plan */}
        <div className="md:col-span-3 p-8 rounded-[2.5rem] bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <h3 className="text-2xl font-bold mb-2">Unlimited Studio</h3>
            <p className="text-gray-500 dark:text-white/50 mb-4 max-w-xl">The ultimate package for studios and heavy users. Get unlimited credits, higher tier audio enhancement, and multiple upload options.</p>
            <ul className="flex flex-wrap gap-6">
              <li className="flex items-center gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Unlimited Credits</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Multiple Uploads</li>
              <li className="flex items-center gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> Highest Tier Enhancement</li>
            </ul>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <div className="mb-4 text-center">
              <span className="text-5xl font-extrabold">$60</span>
              <span className="text-gray-500 dark:text-white/50">/month</span>
            </div>
            <button 
              onClick={() => openSubscriptionModal('unlimited')}
              className="px-8 py-4 rounded-2xl bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-white/90 font-bold transition-colors shadow-xl"
            >
              Get Unlimited
            </button>
          </div>
        </div>
      </div>
    </motion.section>

        {/* Before & After Showcase */}
        <motion.section 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-32"
        >
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-bold mb-6">Excellent Quality</h2>
            <p className="text-gray-500 dark:text-white/50 text-lg max-w-2xl mx-auto">Hear the difference. Our AI models are trained to isolate specific noise profiles while leaving the primary audio untouched.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {NOISE_TYPES.map((type, idx) => (
              <div key={idx} className="p-6 rounded-3xl bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    {type.icon}
                  </div>
                  <h3 className="font-semibold text-lg">{type.name}</h3>
                </div>
                <div className="space-y-4">
                  <div className="bg-gray-100 dark:bg-black/50 rounded-xl p-3 flex items-center justify-between border border-gray-200 dark:border-white/5">
                    <span className="text-xs font-medium text-gray-500 dark:text-white/40 uppercase tracking-wider">Before</span>
                    <button className="w-8 h-8 rounded-full bg-white dark:bg-white/10 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-white/20 transition-colors text-gray-900 dark:text-white shadow-sm dark:shadow-none">
                      <Play className="w-4 h-4 ml-0.5" />
                    </button>
                  </div>
                  <div className="bg-indigo-50 dark:bg-indigo-500/10 rounded-xl p-3 flex items-center justify-between border border-indigo-100 dark:border-indigo-500/20">
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">After</span>
                    <button className="w-8 h-8 rounded-full bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center hover:bg-indigo-500 dark:hover:bg-indigo-400 transition-colors shadow-lg shadow-indigo-500/20">
                      <Play className="w-4 h-4 text-white ml-0.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* How it Works */}
        <motion.section 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-32 relative"
        >
          <div className="absolute inset-0 bg-indigo-50 dark:bg-indigo-500/5 rounded-[3rem] -z-10" />
          <div className="p-10 sm:p-16 rounded-[3rem] border border-gray-200 dark:border-white/5">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-5xl font-bold mb-6">3 Easy Steps</h2>
              <p className="text-gray-500 dark:text-white/50 text-lg max-w-2xl mx-auto">Remove noise from audio & video online for free without learning complex editing tools.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
              {/* Connecting Line */}
              <div className="hidden md:block absolute top-12 left-[15%] right-[15%] h-0.5 bg-indigo-100 dark:bg-indigo-500/20" />
              
              {STEPS.map((step, idx) => (
                <div key={idx} className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-24 h-24 rounded-full bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-white/10 flex items-center justify-center mb-6 shadow-xl relative group">
                    <div className="absolute inset-0 rounded-full bg-indigo-100 dark:bg-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                      {step.icon}
                    </div>
                    <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-indigo-500/20">
                      {idx + 1}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                  <p className="text-gray-500 dark:text-white/50 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Creators & Tools Grid */}
        <motion.section 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-32 grid grid-cols-1 lg:grid-cols-2 gap-8"
        >
          {/* Creators */}
          <div className="p-10 rounded-[2.5rem] bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/5">
            <h2 className="text-3xl font-bold mb-4">Designed for Creators</h2>
            <p className="text-gray-500 dark:text-white/50 mb-8">Millions of creators use SonicPure AI to enhance the quality of their content.</p>
            <div className="flex flex-wrap gap-3">
              {CREATORS.map((creator, idx) => (
                <span key={idx} className="px-4 py-2 rounded-full bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm font-medium hover:bg-gray-100 dark:hover:bg-white/10 transition-colors cursor-default">
                  {creator}
                </span>
              ))}
            </div>
          </div>

          {/* Other Tools */}
          <div className="p-10 rounded-[2.5rem] bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
            <h2 className="text-3xl font-bold mb-4">Power Your Sound</h2>
            <p className="text-indigo-800/60 dark:text-indigo-200/60 mb-8">Explore our suite of upcoming AI audio tools.</p>
            <div className="grid grid-cols-2 gap-3">
              {OTHER_TOOLS.map((tool, idx) => (
                <div key={idx} className="flex items-center gap-2 p-3 rounded-xl bg-white dark:bg-black/20 border border-gray-200 dark:border-white/5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-black/40 transition-colors cursor-pointer group">
                  <ArrowRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400 opacity-0 -ml-6 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                  <span>{tool}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Testimonials */}
        <motion.section 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-32 mb-16"
        >
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-bold mb-6">What People Are Saying</h2>
            <p className="text-gray-500 dark:text-white/50 text-lg max-w-2xl mx-auto">Join thousands of satisfied creators who have transformed their audio.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, idx) => (
              <motion.div 
                key={idx} 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="p-8 rounded-3xl bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 relative hover:border-indigo-500/30 transition-colors group"
              >
                <Quote className="absolute top-6 right-6 w-8 h-8 text-gray-200 dark:text-white/5 group-hover:text-indigo-500/20 transition-colors" />
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-500/30">
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold">{t.name}</h4>
                    <p className="text-xs text-gray-500 dark:text-white/40 uppercase tracking-wider">{t.role}</p>
                  </div>
                </div>
                <p className="text-gray-600 dark:text-white/70 leading-relaxed italic">"{t.text}"</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* FAQ Section */}
        <motion.section 
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-32 mb-16 max-w-3xl mx-auto"
        >
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-bold mb-6">Frequently Asked Questions</h2>
            <p className="text-gray-500 dark:text-white/50 text-lg">Everything you need to know about SonicPure AI.</p>
          </div>
          <div className="space-y-4">
            {FAQS.map((faq, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="border border-gray-200 dark:border-white/10 rounded-2xl overflow-hidden bg-white dark:bg-white/[0.02]"
              >
                <button
                  onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-6 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors"
                >
                  <span className="font-semibold text-lg pr-8">{faq.question}</span>
                  {openFaqIndex === idx ? (
                    <ChevronUp className="w-5 h-5 text-indigo-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
                  )}
                </button>
                <AnimatePresence>
                  {openFaqIndex === idx && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="px-6 pb-6 text-gray-600 dark:text-white/60 leading-relaxed"
                    >
                      {faq.answer}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </motion.section>

      </main>

      <footer className="py-16 border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#050505]">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <img src="/logo.png" alt="" className="h-9 w-9 object-contain" />
              <span className="font-bold text-lg tracking-tight text-gray-900 dark:text-white">SonicPure <span className="text-indigo-500">AI</span></span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm max-w-sm leading-relaxed mb-6">
              Next-generation audio processing powered by AI. Remove background noise, enhance voices, and achieve studio-quality sound in seconds.
            </p>
            <div className="flex items-center gap-4">
              <a href="#" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <Twitter className="w-5 h-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <Github className="w-5 h-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <Linkedin className="w-5 h-5" />
              </a>
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-white mb-6">Tools</h4>
            <ul className="space-y-4 text-sm text-gray-500 dark:text-gray-400">
              <li><a href="#" className="hover:text-indigo-500 transition-colors">Noise Removal</a></li>
              <li><a href="#" className="hover:text-indigo-500 transition-colors">Voice Isolation</a></li>
              <li><a href="#" className="hover:text-indigo-500 transition-colors">Podcast Enhancer</a></li>
              <li><a href="#" className="hover:text-indigo-500 transition-colors">API Access</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-white mb-6">Contact</h4>
            <ul className="space-y-4 text-sm text-gray-500 dark:text-gray-400">
              <li><a href="mailto:support@sonicpure.ai" className="hover:text-indigo-500 transition-colors flex items-center gap-2"><Mail className="w-4 h-4" /> support@sonicpure.ai</a></li>
              <li><a href="#" className="hover:text-indigo-500 transition-colors">Help Center</a></li>
              <li><a href="#" className="hover:text-indigo-500 transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-indigo-500 transition-colors">Privacy Policy</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-16 pt-8 border-t border-gray-200 dark:border-white/5 text-center text-gray-400 dark:text-gray-500 text-xs">
          &copy; {new Date().getFullYear()} SonicPure AI. All rights reserved.
        </div>
      </footer>
    </div>
  );
};

export default App;
