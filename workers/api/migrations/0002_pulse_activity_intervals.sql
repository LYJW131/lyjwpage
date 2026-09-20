-- 身体活动是已结束的估算区间，归档保留终点，不能按实时状态向后延续。
ALTER TABLE pulse_samples ADD COLUMN until_at INTEGER;
