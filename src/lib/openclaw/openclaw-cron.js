import { invokeTool } from './openclaw.js';

/**
 * List all cron jobs
 */
export async function listCronJobs(options = {}) {
    const { includeDisabled = true } = options;

    try {
        const response = await invokeTool({
            tool: 'cron',
            args: {
                action: 'list',
                includeDisabled
            }
        });

        return {
            jobs: response.jobs || [],
            total: response.jobs?.length || 0
        };
    } catch (error) {
        console.error('Failed to list cron jobs:', error);
        throw error;
    }
}

/**
 * Add a new cron job
 */
export async function addCronJob(job) {
    try {
        const response = await invokeTool({
            tool: 'cron',
            args: {
                action: 'add',
                job
            }
        });

        return response;
    } catch (error) {
        console.error('Failed to add cron job:', error);
        throw error;
    }
}

/**
 * Update a cron job
 */
export async function updateCronJob(jobId, updates) {
    try {
        const response = await invokeTool({
            tool: 'cron',
            args: {
                action: 'update',
                jobId,
                updates
            }
        });

        return response;
    } catch (error) {
        console.error('Failed to update cron job:', error);
        throw error;
    }
}

/**
 * Delete a cron job
 */
export async function deleteCronJob(jobId) {
    try {
        const response = await invokeTool({
            tool: 'cron',
            args: {
                action: 'remove',
                jobId
            }
        });

        return response;
    } catch (error) {
        console.error('Failed to delete cron job:', error);
        throw error;
    }
}

/**
 * Run a cron job immediately
 */
export async function runCronJob(jobId) {
    try {
        const response = await invokeTool({
            tool: 'cron',
            args: {
                action: 'run',
                jobId
            }
        });

        return response;
    } catch (error) {
        console.error('Failed to run cron job:', error);
        throw error;
    }
}
