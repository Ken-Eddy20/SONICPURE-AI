import React from 'react';
import { Mic2, Wand2, Target, CheckCircle2, AlertTriangle, ArrowUpRight } from 'lucide-react';

interface FeatureSelectorProps {
  selectedFeature: string | null;
  onFeatureSelect: (feature: string) => void;
  userCredits: number | null;
  isUnlimited: boolean;
  userPlan: "free" | "payg" | "pro" | "audio_master";
}

const FEATURES = [
  { 
    id: 'noise_removal', 
    icon: <Mic2 className="w-6 h-6" />, 
    title: 'Noise Removal', 
    description: 'Remove background noise, hums, and unwanted sounds'
  },
  { 
    id: 'audio_enhancement', 
    icon: <Wand2 className="w-6 h-6" />, 
    title: 'Audio Enhancement', 
    description: 'Full studio quality sound with dynamic EQ, leveling, and clarity'
  },
  { 
    id: 'voice_clarity', 
    icon: <Target className="w-6 h-6" />, 
    title: 'Voice Clarity', 
    description: 'Clean voice with filler word removal (um, uh, like) and silence trimming'
  }
];

export default function FeatureSelector({
  selectedFeature,
  onFeatureSelect,
  userCredits,
  isUnlimited,
  userPlan
}: FeatureSelectorProps) {
  const isFullQuality = userPlan === 'pro' || userPlan === 'audio_master';

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between text-sm">
        <h3 className="font-bold text-gray-900 dark:text-white text-lg">Select Processing Profile</h3>
        <div className="font-medium px-3 py-1 bg-gray-100 dark:bg-white/5 rounded-full text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/10">
          {isUnlimited ? (
            'Full Access'
          ) : (
            `You have ${userCredits ?? 0} credits remaining`
          )}
        </div>
      </div>

      {/* Feature Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {FEATURES.map((feat) => {
          const isSelected = selectedFeature === feat.id;
          return (
            <div 
              key={feat.id}
              onClick={() => onFeatureSelect(feat.id)}
              className={`relative overflow-hidden cursor-pointer rounded-2xl border-2 transition-all flex flex-col ${
                isSelected 
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 shadow-lg shadow-indigo-500/20'
                  : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#111] hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:bg-white dark:hover:bg-white/5'
              }`}
            >
              <div className="p-5 flex-1">
                <div className={`w-12 h-12 rounded-xl mb-4 flex items-center justify-center ${
                  isSelected 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300'
                }`}>
                  {feat.icon}
                </div>
                <h4 className={`font-bold mb-2 ${isSelected ? 'text-indigo-900 dark:text-indigo-200' : 'text-gray-900 dark:text-white'}`}>
                  {feat.title}
                </h4>
                <p className={`text-sm mb-4 leading-relaxed ${isSelected ? 'text-indigo-800 dark:text-indigo-300/80' : 'text-slate-600 dark:text-gray-400'}`}>
                  {feat.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
