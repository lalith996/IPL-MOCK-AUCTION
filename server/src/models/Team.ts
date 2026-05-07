import mongoose, { Schema, Document } from 'mongoose';

export interface ITeam extends Document {
    name: string;
    userId?: string; // Null if AI bot
    isBot: boolean;
    roomId: string;
    budget: number;
    players: mongoose.Types.ObjectId[]; // Array of Player IDs
    logo?: string;
}

const TeamSchema: Schema = new Schema({
    name: { type: String, required: true },
    userId: { type: String },
    isBot: { type: Boolean, default: false },
    roomId: { type: Schema.Types.ObjectId, ref: 'AuctionRoom', required: true },
    budget: { type: Number, required: true, default: 100000000 }, // Default 100 Cr (in units, e.g., 1 unit = 1 Lakh) -> 100 * 100 = 10000
    players: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
    logo: { type: String }
}, {
    timestamps: true
});

export default mongoose.model<ITeam>('Team', TeamSchema);
