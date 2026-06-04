'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Play, SkipForward, Plus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Can } from '@/components/shared/Can';
import { repairApi, STAGE_LABELS, type JobStage, type StageType } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDatetime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const STAGE_STATUS_STYLE: Record<string, string> = {
  pending:     'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]',
  in_progress: 'border-[var(--warning)] bg-[var(--warning)]/10 text-[var(--warning)]',
  completed:   'border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]',
  skipped:     'border-[var(--text-muted)] bg-[var(--surface-2)] text-[var(--text-muted)] opacity-60',
};

const STAGE_ICON: Record<string, React.ReactNode> = {
  pending:     <Clock className="h-3.5 w-3.5" />,
  in_progress: <Play className="h-3.5 w-3.5" />,
  completed:   <CheckCircle2 className="h-3.5 w-3.5" />,
  skipped:     <SkipForward className="h-3.5 w-3.5" />,
};

interface StageWorkflowProps {
  jobId: string;
  stages: JobStage[];
  jobStatus: string;
}

export function StageWorkflow({ jobId, stages, jobStatus }: StageWorkflowProps) {
  const queryClient = useQueryClient();
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const advanceMutation = useMutation({
    mutationFn: ({ stageId, action, notes }: { stageId: string; action: 'complete' | 'skip'; notes?: string }) =>
      repairApi.setStages(jobId, { stage_id: stageId, action, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.job(jobId) });
      toast.success('Stage updated');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INVALID_STATUS_TRANSITION') {
        toast.error('Another stage is already in progress');
        queryClient.invalidateQueries({ queryKey: qk.job(jobId) });
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update stage');
      }
    },
  });

  const isJobEditable = !['closed', 'cancelled', 'delivered'].includes(jobStatus);

  return (
    <div className="space-y-3">
      {stages.length === 0 ? (
        <p className="text-body-sm text-[var(--text-muted)] py-2">No stages defined for this job.</p>
      ) : (
        <div className="relative">
          <div className="absolute left-[19px] top-5 bottom-5 w-px bg-[var(--border)]" />
          <div className="space-y-3">
            {stages
              .sort((a, b) => a.stage_order - b.stage_order)
              .map((stage) => (
                <div key={stage.id} className="flex gap-3 relative">
                  <div className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-full border-2 shrink-0 z-10',
                    STAGE_STATUS_STYLE[stage.status]
                  )}>
                    {STAGE_ICON[stage.status]}
                  </div>

                  <div className={cn(
                    'flex-1 rounded-md border p-3',
                    stage.status === 'in_progress'
                      ? 'border-[var(--warning)] bg-[var(--warning)]/5'
                      : 'border-[var(--border)] bg-[var(--surface)]'
                  )}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-body-sm font-medium text-[var(--text)]">
                          {stage.stage_order}. {STAGE_LABELS[stage.stage_type as StageType] ?? stage.stage_type}
                        </p>
                        {stage.assigned_technician_name && (
                          <p className="text-xs text-[var(--text-muted)]">{stage.assigned_technician_name}</p>
                        )}
                        {stage.completed_at && (
                          <p className="text-xs text-[var(--text-muted)]">
                            Completed {formatDatetime(stage.completed_at)}
                          </p>
                        )}
                        {stage.notes && (
                          <p className="text-xs text-[var(--text-muted)] mt-1 italic">{stage.notes}</p>
                        )}
                      </div>

                      {isJobEditable && stage.status === 'in_progress' && (
                        <Can permission="repair.jobs.change_status">
                          <div className="flex flex-col gap-1 shrink-0">
                            <div className="flex gap-1.5">
                              <Input
                                className="h-8 text-xs w-32"
                                placeholder="Notes (optional)"
                                value={noteInputs[stage.id] ?? ''}
                                onChange={(e) => setNoteInputs((p) => ({ ...p, [stage.id]: e.target.value }))}
                              />
                              <Button
                                size="sm"
                                className="h-8 text-xs min-h-[auto]"
                                onClick={() =>
                                  advanceMutation.mutate({
                                    stageId: stage.id,
                                    action: 'complete',
                                    notes: noteInputs[stage.id],
                                  })
                                }
                                disabled={advanceMutation.isPending}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Done
                              </Button>
                            </div>
                          </div>
                        </Can>
                      )}

                      {isJobEditable && stage.status === 'pending' && (
                        <Can permission="repair.jobs.change_status">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-[var(--text-muted)] min-h-[auto]"
                            onClick={() =>
                              advanceMutation.mutate({ stageId: stage.id, action: 'skip' })
                            }
                            disabled={advanceMutation.isPending}
                          >
                            <SkipForward className="h-3.5 w-3.5" />
                            Skip
                          </Button>
                        </Can>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
