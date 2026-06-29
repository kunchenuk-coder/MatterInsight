import React, { useState } from 'react';

import type { MoodBoard, MoodBoardVisibility } from '../types';

import {
  inviteMoodboardCollaborator,
  publishMoodBoard,
  setMoodBoardVisibility,
  upsertMoodboard,
} from '../services/moodboardService';



const VISIBILITY_OPTIONS: { value: MoodBoardVisibility; label: string; hint: string }[] = [

  { value: 'private', label: '私密', hint: '仅自己可见' },

  { value: 'team', label: '团队', hint: '自己 + 受邀协作者' },

  { value: 'public', label: '公开', hint: '允许发布，需点击发布按钮后才在首页展示' },

];



interface MoodBoardPublishControlsProps {
  ownerId: string;
  activeBoard: MoodBoard;
  activeMoodboardId: string;
  setMoodboards: React.Dispatch<React.SetStateAction<MoodBoard[]>>;
  onPublished?: () => void;
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



  const visibility = activeBoard.visibility ?? 'private';

  const isPublished = activeBoard.isPublished ?? false;



  const patchActiveBoard = (patch: MoodBoard) => {

    setMoodboards((prev) =>

      prev.map((b) => (b.id === activeMoodboardId ? patch : b))

    );

  };



  const handleVisibilityChange = (next: MoodBoardVisibility) => {

    patchActiveBoard(setMoodBoardVisibility(activeBoard, next));

    if (next === 'team') setShowTeamInvite(true);

  };



  const handlePublish = async () => {
    if (visibility !== 'public') {
      window.alert('请先将可见性设为「公开」，再点击发布。');
      return;
    }
    if (
      !window.confirm(
        '确定发布此情绪板？发布后所有用户均可在首页探索库瀑布流中浏览。'
      )
    ) {
      return;
    }

    const published = publishMoodBoard(activeBoard);
    patchActiveBoard(published);

    const ok = await upsertMoodboard(ownerId, published);
    if (!ok) {
      window.alert('发布状态保存失败，请检查网络后重试。');
      return;
    }
    onPublished?.();
  };



  const handleInvite = async () => {

    setInviteMsg('');

    const result = await inviteMoodboardCollaborator(

      ownerId,

      activeMoodboardId,

      inviteEmail

    );

    if (result.ok) {

      setInviteMsg('邀请已发送');

      setInviteEmail('');

    } else if (!result.ok) {

      setInviteMsg(result.error);

    }

  };



  const statusLabel = isPublished

    ? '已发布'

    : visibility === 'public'

      ? '可发布'

      : visibility === 'team'

        ? '团队'

        : '私密';



  return (

    <div className="relative">

      <button

        type="button"

        onClick={() => setPanelOpen((v) => !v)}

        className={`px-3 md:px-4 py-2 rounded-full text-[10px] md:text-xs font-bold border transition-all ${

          isPublished

            ? 'bg-green-50 text-green-700 border-green-200'

            : visibility === 'public'

              ? 'bg-amber-50 text-amber-700 border-amber-200'

              : visibility === 'team'

                ? 'bg-blue-50 text-blue-700 border-blue-200'

                : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'

        }`}

        title="可见性设置"

      >

        {statusLabel}

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

        <div className="space-y-1.5 mb-4">

          {VISIBILITY_OPTIONS.map((opt) => (

            <label

              key={opt.value}

              className={`flex items-start gap-2 p-2 rounded-xl cursor-pointer transition-colors ${

                visibility === opt.value ? 'bg-black text-white' : 'hover:bg-gray-50'

              }`}

            >

              <input

                type="radio"

                name="board-visibility"

                checked={visibility === opt.value}

                onChange={() => handleVisibilityChange(opt.value)}

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

          <div className="mb-4 pt-3 border-t border-gray-100">

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



        <button

          type="button"

          onClick={handlePublish}

          disabled={isPublished || visibility !== 'public'}

          className="w-full py-2.5 bg-black text-white rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform"

        >

          {isPublished ? '已发布' : '发布情绪板'}

        </button>

          </div>

        </>

      )}

    </div>

  );

};



export default MoodBoardPublishControls;

