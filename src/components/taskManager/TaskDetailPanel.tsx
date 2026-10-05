import { useState, useEffect, useRef } from 'react';
import './taskDetail.css';
import { useTaskStore } from '../../stores/taskStore';
import { useTaskCommentStore } from '../../stores/taskCommentStore';
import { TaskCommentThread } from './TaskCommentThread';
import { TaskCommentInput } from './TaskCommentInput';
import type { TaskComment } from '../../types';

export function TaskDetailPanel() {
  const getActiveTask = useTaskStore((state) => state.getActiveTask);
  const { loadComments, getComments } = useTaskCommentStore();

  const task = getActiveTask();
  const threadRef = useRef<HTMLDivElement>(null);
  const [replyToComment, setReplyToComment] = useState<TaskComment | null>(null);

  useEffect(() => {
    if (task) {
      loadComments(task.id);
    }
  }, [task?.id, loadComments]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [getComments(task?.id ?? '').length]);

  if (!task) {
    return (
      <div id="task-detail-panel" className="flex-col h-full items-center justify-center subtle" style={{ background: 'rgba(233, 233, 233, 0)' }}>
        <p className="txt-xs">Select a task from the sidebar</p>
      </div>
    );
  }

  const comments = getComments(task.id);

  return (
    <div id="task-detail-panel" className="panel flex-col flex-1 min-h-0" style={{ background: 'rgba(233, 233, 233, 0)' }}>

      <div className="tdp-overlay-region">
        <div id="tdc-thread" ref={threadRef} className="panel-body ai-scroll flex-1 overflow-y-a" style={{ padding: 0 }}>
          <TaskCommentThread comments={comments} onReplyComment={setReplyToComment} />
        </div>
      </div>

      <div className="tdp-comment-footer panel-footer">
        <TaskCommentInput replyToComment={replyToComment} onClearReply={() => setReplyToComment(null)} />
      </div>
    </div>
  );
}
