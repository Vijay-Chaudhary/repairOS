import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../uiStore';

describe('uiStore — jobs list prefs', () => {
  beforeEach(() => {
    useUiStore.setState({ jobsListDensity: 'comfortable', jobsHiddenColumns: [] });
  });

  it('defaults to comfortable density and no hidden columns', () => {
    const s = useUiStore.getState();
    expect(s.jobsListDensity).toBe('comfortable');
    expect(s.jobsHiddenColumns).toEqual([]);
  });

  it('sets density', () => {
    useUiStore.getState().setJobsListDensity('compact');
    expect(useUiStore.getState().jobsListDensity).toBe('compact');
  });

  it('toggles a column hidden then visible', () => {
    useUiStore.getState().toggleJobsColumn('charge');
    expect(useUiStore.getState().jobsHiddenColumns).toContain('charge');
    useUiStore.getState().toggleJobsColumn('charge');
    expect(useUiStore.getState().jobsHiddenColumns).not.toContain('charge');
  });
});
