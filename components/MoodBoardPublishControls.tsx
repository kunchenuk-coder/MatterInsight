import React, { useState } from 'react';
import type { MoodBoard, MoodBoardVisibility } from '../types';
import {
  applyMoodBoardVisibility,
  inviteMoodboardCollaborator,
  upsertMoodboard,
} from '../services/moodboardService';

const VISIBILITY_OPTIONS: { value: MoodBoardVisibility; label: string; hint: string }[] = [
  { value: 'private', label: '私密', hint: '仅自己可见' },
  { value: 'team', label: '团队', hint: '自己 + 受邀协作者' },
  { value: 'public', label: '公开', hint: '选择后立即在首页探索库展示' },
];

interface MoodBoardPublishControlsProps {
  ownerId: string;
  activeBoard: MoodBoard;
  activeMoodboardId: string;
  setMoodboards: React.Dispatch<React.SetStateAction<MoodBoard[]>>;
  onPublished?: () => void;
}

function statusPillStyle(visibility: MoodBoardVisibility, isPublished: boolean, saving: boolean) {
  if (saving) {
    return 'bg-gray-100 text-gray-500 border-gray-200';
  }
  if (visibility === 'private') {
    return 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200';
  }
  if (visibility === 'team') {
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }
  if (isPublished) {
    return 'bg-green-50 text-green-700 border-green-200';
  }
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function statusLabel(visibility: MoodBoardVisibility, isPublished: boolean, saving: boolean) {
  if (saving) return '保存中…';
  if (visibility === 'private') return '私密';
  if (visibility === 'team') return '团队';
  if (isPublished) return '已发布';
  return '可发布';
}

const MoodBoardPublishControls: React.FC<MoodBoardPublishControlsProps> = ({
  ownerId,
  activeBoard,
  activeMoodboardId,
  setMoodboards,
  onPublished,
}) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState('');
  const [showTeamInvite, setShowTeamInvite] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const visibility = activeBoard.visibility ?? 'private';
  const isPublished = activeBoard.isPublished ?? false;

  const patchActiveBoard = (patch: MoodBoard) => {
    setMoodboards((prev) => prev.map((b) => (b.id === activeMoodboardId ? patch : b)));
  };

  const handleVisibilityChange = async (next: MoodBoardVisibility) => {
    if (saving || next === visibility) return;

    const previous = activeBoard;
    const updated = applyMoodBoardVisibility(activeBoard, next);
    patchActiveBoard(updated);

    if (next === 'team') setShowTeamInvite(true);

    setSaving(true);
    const ok = await upsertMoodboard(ownerId, updated);
    setSaving(false);

    if (!ok) {
      patchActiveBoard(previous);
      window.alert('可见性保存失败，请检查网络后重试。');
      return;
    }

    if (next === 'public') {
      onPublished?.();
    }
  };

  const handleInvite = async () => {
    setInviteMsg('');
    const result = await inviteMoodboardCollaborator(ownerId, activeMoodboardId, inviteEmail);
    if (result.ok) {
      setInviteMsg('邀请已发送');
      setInviteEmail('');
    } else if (!result.ok) {
      setInviteMsg(result.error);
    }
  };

  const pillLabel = statusLabel(visibility, isPublished, saving);
  const pillClass = statusPillStyle(visibility, isPublished, saving);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        className={`px-3 md:px-4 py-2 rounded-full text-[10px] md:text-xs font-bold border transition-all ${pillClass}`}
        title="可见性设置"
      >
        {pillLabel}
      </button>

      {panelOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[99] cursor-default"
            aria-label="关闭"
            onClick={() => setPanelOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl p-4 z-[100]">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">
              可见性
            </p>
            <div className="space-y-1.5">
              {VISIBILITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2 p-2 rounded-xl transition-colors ${
                    saving
                      ? 'opacity-60 cursor-wait'
                      : visibility === opt.value
                        ? 'bg-black text-white cursor-default'
                        : 'hover:bg-gray-50 cursor-pointer'
                  }`}
                >
                  <input
                    type="radio"
                    name="board-visibility"
                    checked={visibility === opt.value}
                    disabled={saving}
                    onChange={() => void handleVisibilityChange(opt.value)}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <span className="block text-xs font-bold">{opt.label}</span>
                    <span
                      className={`block text-[10px] ${
                        visibility === opt.value ? 'text-white/70' : 'text-gray-400'
                      }`}
                    >
                      {opt.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {visibility === 'team' && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowTeamInvite((v) => !v)}
                  className="text-[10px] font-bold text-blue-600 hover:underline mb-2"
                >
                  {showTeamInvite ? '收起邀请' : '邀请协作者'}
                </button>
                {showTeamInvite && (
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="协作者邮箱"
                      className="flex-1 min-w-0 text-xs p-2 rounded-lg bg-gray-50 border-none outline-none focus:ring-1 focus:ring-black"
                    />
                    <button
                      type="button"
                      onClick={() => void handleInvite()}
                      className="shrink-0 px-3 py-2 bg-black text-white text-[10px] font-bold rounded-lg"
                    >
                      邀请
                    </button>
                  </div>
                )}
                {inviteMsg && (
                  <p className="text-[10px] font-bold text-gray-500 mt-2">{inviteMsg}</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MoodBoardPublishControls;
