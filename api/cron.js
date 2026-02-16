import { listCronJobs, addCronJob, updateCronJob, deleteCronJob, runCronJob } from './lib/openclaw-cron.js';

export default async function handler(req, res) {
    const { id, action, includeDisabled } = req.query;

    // GET /api/cron - List jobs
    // POST /api/cron - Add job
    // PATCH /api/cron?id=xxx - Update job
    // DELETE /api/cron?id=xxx - Delete job
    // POST /api/cron?id=xxx&action=run - Run job

    if (req.method === 'GET') {
        try {
            const jobs = await listCronJobs({
                includeDisabled: includeDisabled === 'true'
            });
            return res.status(200).json(jobs);
        } catch (error) {
            console.error('Failed to list cron jobs:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'POST') {
        // Run job
        if (id && action === 'run') {
            try {
                const result = await runCronJob(id);
                return res.status(200).json(result);
            } catch (error) {
                console.error(`Failed to run cron job ${id}:`, error);
                return res.status(500).json({ error: error.message });
            }
        }

        // Add job
        try {
            const job = req.body;
            const result = await addCronJob(job);
            return res.status(201).json(result);
        } catch (error) {
            console.error('Failed to create cron job:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PATCH') {
        if (!id) {
            return res.status(400).json({ error: 'Job ID required' });
        }

        try {
            const updates = req.body;
            const result = await updateCronJob(id, updates);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`Failed to update cron job ${id}:`, error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        if (!id) {
            return res.status(400).json({ error: 'Job ID required' });
        }

        try {
            const result = await deleteCronJob(id);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`Failed to delete cron job ${id}:`, error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
