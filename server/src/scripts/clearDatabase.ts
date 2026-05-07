import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Player from '../models/Player';
import Team from '../models/Team';
import AuctionRoom from '../models/AuctionRoom';
import { connectDB } from '../config/db';

dotenv.config();

const clearDatabase = async () => {
    try {
        console.log('🗑️  Starting Database Cleanup...\n');
        await connectDB();

        // Clear all collections
        console.log('🧹 Clearing Players collection...');
        const playersDeleted = await Player.deleteMany({});
        console.log(`   ✅ Deleted ${playersDeleted.deletedCount} players`);

        console.log('🧹 Clearing Teams collection...');
        const teamsDeleted = await Team.deleteMany({});
        console.log(`   ✅ Deleted ${teamsDeleted.deletedCount} teams`);

        console.log('🧹 Clearing AuctionRooms collection...');
        const roomsDeleted = await AuctionRoom.deleteMany({});
        console.log(`   ✅ Deleted ${roomsDeleted.deletedCount} auction rooms`);

        console.log('\n✅ Database cleared successfully!');
        console.log('\n📊 Summary:');
        console.log(`   Players removed: ${playersDeleted.deletedCount}`);
        console.log(`   Teams removed: ${teamsDeleted.deletedCount}`);
        console.log(`   Auction rooms removed: ${roomsDeleted.deletedCount}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error clearing database:', error);
        process.exit(1);
    }
};

clearDatabase();
