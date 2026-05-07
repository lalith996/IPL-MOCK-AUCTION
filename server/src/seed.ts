import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import { CricsheetService } from './services/cricsheet.service';
import Player from './models/Player';
import { connectDB } from './config/db';

dotenv.config();

const seedDB = async () => {
    try {
        console.log('🌱 Starting Database Seed...');
        await connectDB();

        // 1. Clear existing players
        console.log('🧹 Clearing existing players...');
        await Player.deleteMany({});

        // 2. Process Cricsheet Data
        const jsonDir = path.join(__dirname, '../../ipl_json'); // Adjust based on your local path relative to this script
        // NOTE: In production, path might need adjustment. Assumes ipl_json is 2 levels up from src/seed.ts
        const processor = new CricsheetService(jsonDir);

        console.log('📊 Processing Cricsheet JSONs...');
        const refinedPlayers = await processor.processAllFiles();

        console.log(`✨ Processed ${refinedPlayers.length} valid players.`);

        // 3. Insert into DB
        console.log('💾 Inserting into MongoDB...');
        await Player.insertMany(refinedPlayers);

        console.log('✅ Seeding Completed Successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding Failed:', error);
        process.exit(1);
    }
};

seedDB();
