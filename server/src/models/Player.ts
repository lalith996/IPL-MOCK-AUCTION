import mongoose, { Schema, Document } from 'mongoose';

export interface IPlayerStats {
    matches: number;
    innings: number;
    runs: number;
    ballsFaced: number;
    average: number;
    strikeRate: number;
    hundreds: number;
    fifties: number;
    fours: number;
    sixes: number;
    wickets: number;
    economy: number;
    bowlingAverage: number;
    bowlingStrikeRate: number;
}

export interface ISpecialistRatings {
    deathBowler: number;
    powerplayBatter: number;
    powerplayBowler: number;
    middleOrderAnchor: number;
    finisher: number;
}

export interface IRecentForm {
    date: string;
    runs: number;
    wickets: number;
    venue: string;
}

export interface IPlayer extends Document {
    name: string;
    role: 'Batsman' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper';
    stats: IPlayerStats; // Overall/Lifetime stats
    testStats: IPlayerStats;
    odiStats: IPlayerStats;
    t20iStats: IPlayerStats;
    t20Stats: IPlayerStats;
    iplStats: IPlayerStats;
    team?: string; // IPL 2026 team (CSK, MI, RCB, etc.)
    cricsheetId: string; // Unique ID from Cricsheet
    isSold: boolean;
    soldTo?: string; // Team ID
    soldPrice?: number;
    formScore: number; // 0-100
    valueScore: number; // 0-100 (AI Valuation)
    tier: 'Marquee' | 'Batter' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper' | 'Uncapped';
    nationality: string;
    isOverseas: boolean;
    specialistRatings: ISpecialistRatings;
    recentForm: IRecentForm[];
}

const statsSchema = {
    matches: { type: Number, default: 0 },
    innings: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    ballsFaced: { type: Number, default: 0 },
    average: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    hundreds: { type: Number, default: 0 },
    fifties: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    economy: { type: Number, default: 0 },
    bowlingAverage: { type: Number, default: 0 },
    bowlingStrikeRate: { type: Number, default: 0 }
};

const PlayerSchema: Schema = new Schema({
    name: { type: String, required: true },
    role: { type: String, required: true, enum: ['Batsman', 'Bowler', 'All-Rounder', 'Wicketkeeper'] },
    stats: statsSchema, // Lifetime/Overall stats
    testStats: statsSchema,
    odiStats: statsSchema,
    t20iStats: statsSchema,
    t20Stats: statsSchema,
    iplStats: statsSchema,
    team: { type: String }, // IPL 2026 team abbreviation
    cricsheetId: { type: String, required: true, unique: true },
    isSold: { type: Boolean, default: false },
    soldTo: { type: Schema.Types.ObjectId, ref: 'Team' },
    soldPrice: { type: Number },
    formScore: { type: Number, default: 50 },
    valueScore: { type: Number, default: 50 },
    tier: { type: String, default: 'Uncapped' },
    nationality: { type: String, required: true },
    isOverseas: { type: Boolean, default: false },
    specialistRatings: {
        deathBowler: { type: Number, default: 0 },
        powerplayBatter: { type: Number, default: 0 },
        powerplayBowler: { type: Number, default: 0 },
        middleOrderAnchor: { type: Number, default: 0 },
        finisher: { type: Number, default: 0 }
    },
    recentForm: [{
        date: { type: String },
        runs: { type: Number },
        wickets: { type: Number },
        venue: { type: String }
    }]
}, {
    timestamps: true
});

export default mongoose.model<IPlayer>('Player', PlayerSchema);
