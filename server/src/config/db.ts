import mongoose from 'mongoose';
import { env } from './env';

const MAX_RETRIES = 3;
const RETRY_INTERVAL = 5000; // 5 seconds

export const connectDB = async (retryCount = 0) => {
    try {
        const conn = await mongoose.connect(env.DATABASE_URL);
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${(error as Error).message}`);

        if (retryCount < MAX_RETRIES) {
            console.log(`Retrying connection in ${RETRY_INTERVAL / 1000} seconds... (${retryCount + 1}/${MAX_RETRIES})`);
            setTimeout(() => connectDB(retryCount + 1), RETRY_INTERVAL);
        } else {
            console.error('❌ Max retries reached. Exiting application...');
            process.exit(1);
        }
    }
};

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected. Attempting to reconnect...');
    connectDB();
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
});
