import mongoose, { Schema, Document } from 'mongoose';

export interface IAuctionRoom extends Document {
    roomCode: string;
    hostId: string;
    status: 'WAITING' | 'ONGOING' | 'COMPLETED';
    teams: mongoose.Types.ObjectId[];
    currentPlayer?: mongoose.Types.ObjectId | null;
    currentBid: number;
    currentBidder?: mongoose.Types.ObjectId; // Team ID
    bidHistory: {
        teamId: mongoose.Types.ObjectId;
        amount: number;
        timestamp: Date;
    }[];
    unsoldPlayers: mongoose.Types.ObjectId[];
    soldPlayers: mongoose.Types.ObjectId[];
}

const AuctionRoomSchema: Schema = new Schema({
    roomCode: { type: String, required: true, unique: true },
    hostId: { type: String, required: true },
    status: { type: String, enum: ['WAITING', 'ONGOING', 'COMPLETED'], default: 'WAITING' },
    teams: [{ type: Schema.Types.ObjectId, ref: 'Team' }],
    currentPlayer: { type: Schema.Types.ObjectId, ref: 'Player', default: null },
    currentBid: { type: Number, default: 0 },
    currentBidder: { type: Schema.Types.ObjectId, ref: 'Team', default: null },
    bidHistory: [{
        teamId: { type: Schema.Types.ObjectId, ref: 'Team' },
        amount: { type: Number },
        timestamp: { type: Date, default: Date.now }
    }],
    unsoldPlayers: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
    soldPlayers: [{ type: Schema.Types.ObjectId, ref: 'Player' }]
}, {
    timestamps: true
});

export default mongoose.model<IAuctionRoom>('AuctionRoom', AuctionRoomSchema);
