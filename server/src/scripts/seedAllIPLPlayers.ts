import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import Player from '../models/Player';
import { connectDB } from '../config/db';
import { IPL_2026_PLAYERS } from '../data/ipl2026Players';

dotenv.config();

interface CricsheetMatch {
    info?: {
        dates?: string[];
        venue?: string;
        city?: string;
        event?: { name?: string };
        match_type?: string;
        registry?: { people?: { [key: string]: string } };
        players?: { [team: string]: string[] };
    };
    innings?: Array<{
        team: string;
        overs: Array<{
            over: number;
            deliveries: Array<{
                batter: string;
                bowler: string;
                runs: { batter: number; total: number };
                wickets?: Array<{ player_out: string }>;
            }>;
        }>;
    }>;
}

interface FormatStats {
    matches: number;
    innings: number;
    runs: number;
    ballsFaced: number;
    fours: number;
    sixes: number;
    highestScore: number;
    notOuts: number;
    wickets: number;
    ballsBowled: number;
    runsConceded: number;
}

interface PlayerStats {
    name: string;
    nationality: string;
    cricsheetId?: string;
    overall: FormatStats;
    test: FormatStats;
    odi: FormatStats;
    t20i: FormatStats;
    t20: FormatStats;
    ipl: FormatStats;
    powerplayBatting: { runs: number; balls: number; fours: number; sixes: number };
    middleOverBatting: { runs: number; balls: number };
    deathBatting: { runs: number; balls: number; fours: number; sixes: number };
    powerplayBowling: { wickets: number; balls: number; runs: number };
    middleOverBowling: { wickets: number; balls: number; runs: number };
    deathBowling: { wickets: number; balls: number; runs: number };
    recentMatches: Array<{ date: string; runs: number; wickets: number; venue: string }>;
}

const createEmptyFormatStats = (): FormatStats => ({
    matches: 0, innings: 0, runs: 0, ballsFaced: 0, fours: 0, sixes: 0,
    highestScore: 0, notOuts: 0, wickets: 0, ballsBowled: 0, runsConceded: 0
});

// Build nationality and team lookup from IPL 2026 list
const nationalityLookup = new Map<string, string>();
const teamLookup = new Map<string, string>();

// Team mapping based on IPL 2026 players list
const TEAM_PLAYERS: { [team: string]: string[] } = {
    'CSK': ['Anshul Kamboj', 'Gurjapneet Singh', 'Jamie Overton', 'MS Dhoni', 'Mukesh Choudhary', 'Nathan Ellis', 'Noor Ahmad', 'Ramakrishna Ghosh', 'Sanju Samson', 'Ruturaj Gaikwad', 'Shivam Dube', 'Shreyas Gopal', 'Syed Khaleel Ahmed', 'Ayush Mhatre', 'Dewald Brevis', 'Urvil Patel'],
    'DC': ['Abhishek Porel', 'Ajay Mandal', 'Ashutosh Sharma', 'Axar Patel', 'Dushmantha Chameera', 'Karun Nair', 'KL Rahul', 'Kuldeep Yadav', 'Madhav Tiwari', 'Mitchell Starc', 'Mukesh Kumar', 'Nitish Rana', 'Sameer Rizvi', 'T. Natarajan', 'Tripurana Vijay', 'Tristan Stubbs', 'Vipraj Nigam'],
    'GT': ['Anuj Rawat', 'Glenn Phillips', 'Gurnoor Singh Brar', 'Ishant Sharma', 'Jayant Yadav', 'Jos Buttler', 'Kagiso Rabada', 'Kumar Kushagra', 'Manav Suthar', 'Mohammad Siraj', 'Mohd. Arshad Khan', 'Nishant Sindhu', 'Prasidh Krishna', 'R. Sai Kishore', 'Rahul Tewatia', 'Rashid Khan', 'Sai Sudharsan', 'Shahrukh Khan', 'Shubman Gill', 'Washington Sundar'],
    'KKR': ['Ajinkya Rahane', 'Angkrish Raghuvanshi', 'Anukul Roy', 'Harshit Rana', 'Manish Pandey', 'Ramandeep Singh', 'Rinku Singh', 'Rovman Powell', 'Sunil Narine', 'Umran Malik', 'Vaibhav Arora', 'Varun Chakaravarthy'],
    'LSG': ['Abdul Samad', 'Aiden Markram', 'Akash Singh', 'Arjun Tendulkar', 'Arshin Kulkarni', 'Avesh Khan', 'Ayush Badoni', 'Digvesh Rathi', 'Himmat Singh', 'Manimaran Siddharth', 'Matthew Breetzke', 'Mayank Yadav', 'Md Shami', 'Mitchell Marsh', 'Mohsin Khan', 'Nicholas Pooran', 'Prince Yadav', 'Rishabh Pant', 'Shahbaz Ahmed'],
    'MI': ['Allah Ghazanfar', 'Ashwani Kumar', 'Corbin Bosch', 'Deepak Chahar', 'Hardik Pandya', 'Jasprit Bumrah', 'Mayank Markande', 'Mitchell Santner', 'Naman Dhir', 'Raghu Sharma', 'Raj Angad Bawa', 'Robin Minz', 'Rohit Sharma', 'Ryan Rickelton', 'Shardul Thakur', 'Sherfane Rutherford', 'Suryakumar Yadav', 'Tilak Verma', 'Trent Boult', 'Will Jacks'],
    'PBKS': ['Arshdeep Singh', 'Azmatullah Omarzai', 'Harnoor Pannu', 'Harpreet Brar', 'Lockie Ferguson', 'Marco Jansen', 'Marcus Stoinis', 'Mitch Owen', 'Musheer Khan', 'Nehal Wadhera', 'Prabhsimran Singh', 'Priyansh Arya', 'Pyla Avinash', 'Shashank Singh', 'Shreyas Iyer', 'Suryansh Shedge', 'Vishnu Vinod', 'Vyshak Vijaykumar', 'Xavier Bartlett', 'Yash Thakur', 'Yuzvendra Chahal'],
    'RR': ['Dhruv Jurel', 'Donovan Ferreira', 'Jofra Archer', 'Kwena Maphaka', 'Lhuan-Dre Pretorious', 'Nandre Burger', 'Ravindra Jadeja', 'Riyan Parag', 'Sam Curran', 'Sandeep Sharma', 'Shimron Hetmyer', 'Shubham Dubey', 'Tushar Deshpande', 'Vaibhav Suryavanshi', 'Yashaswi Jaiswal', 'Yudhvir Charak'],
    'RCB': ['Abhinandan Singh', 'Bhuvneshwar Kumar', 'Devdutt Padikkal', 'Jacob Bethell', 'Jitesh Sharma', 'Josh Hazlewood', 'Krunal Pandya', 'Nuwan Thushara', 'Phil Salt', 'Rajat Patidar', 'Rasikh Dar', 'Romario Shepherd', 'Suyash Sharma', 'Swapnil Singh', 'Tim David', 'Virat Kohli', 'Yash Dayal'],
    'SRH': ['Abhishek Sharma', 'Aniket Verma', 'Brydon Carse', 'Eshan Malinga', 'Harsh Dubey', 'Harshal Patel', 'Heinrich Klaasen', 'Ishan Kishan', 'Jaydev Unadkat', 'Kamindu Mendis', 'Nitish Kumar Reddy', 'Pat Cummins', 'Smaran Ravichandaran', 'Travis Head', 'Zeeshan Ansari']
};

const buildNationalityAndTeamMap = () => {
    // Build team lookup first
    for (const [team, players] of Object.entries(TEAM_PLAYERS)) {
        players.forEach(playerName => {
            const lowerName = playerName.toLowerCase();
            teamLookup.set(lowerName, team);

            // Also store short name version (V Kohli for Virat Kohli)
            const parts = playerName.split(' ');
            if (parts.length >= 2) {
                const shortName = parts[0][0] + ' ' + parts.slice(1).join(' ');
                teamLookup.set(shortName.toLowerCase(), team);
            }
        });
    }

    // Build nationality lookup
    IPL_2026_PLAYERS.forEach(player => {
        // Store by full name
        nationalityLookup.set(player.name.toLowerCase(), player.nationality);

        // Store by short name (V Kohli for Virat Kohli)
        const parts = player.name.split(' ');
        if (parts.length >= 2) {
            const shortName = parts[0][0] + ' ' + parts.slice(1).join(' ');
            nationalityLookup.set(shortName.toLowerCase(), player.nationality);
        }

        // Store by last name for matching
        const lastName = parts[parts.length - 1];
        if (!nationalityLookup.has(lastName.toLowerCase())) {
            nationalityLookup.set(lastName.toLowerCase(), player.nationality);
        }
    });
};

const guessNationality = (playerName: string): string => {
    const lowerName = playerName.toLowerCase();

    // Direct match
    if (nationalityLookup.has(lowerName)) {
        return nationalityLookup.get(lowerName)!;
    }

    // Check by last name
    const parts = playerName.split(' ');
    const lastName = parts[parts.length - 1].toLowerCase();
    if (nationalityLookup.has(lastName)) {
        return nationalityLookup.get(lastName)!;
    }

    // Default to India for players not in IPL 2026 list
    return 'India';
};

const isInIPL2026List = (playerName: string): boolean => {
    const lowerName = playerName.toLowerCase();

    // Direct match
    if (teamLookup.has(lowerName) || nationalityLookup.has(lowerName)) {
        return true;
    }

    // Match: First letter of firstname + Full last name
    const parts = playerName.split(' ');
    if (parts.length >= 2) {
        const cricsheetFirstInitial = parts[0][0].toLowerCase(); // First letter only
        const cricsheetLastName = parts.slice(1).join(' ').toLowerCase(); // Full last name

        // Check against all IPL 2026 player names
        for (const player of IPL_2026_PLAYERS) {
            const lookupParts = player.name.toLowerCase().split(' ');
            if (lookupParts.length >= 2) {
                const lookupFirstInitial = lookupParts[0][0]; // First letter of firstname
                const lookupLastName = lookupParts.slice(1).join(' '); // Full last name

                // Match only if BOTH first initial AND full last name match exactly
                if (lookupFirstInitial === cricsheetFirstInitial && lookupLastName === cricsheetLastName) {
                    return true;
                }
            }
        }
    }

    return false;
};

const getTeam = (playerName: string): string | undefined => {
    const lowerName = playerName.toLowerCase();

    // Direct match
    if (teamLookup.has(lowerName)) {
        return teamLookup.get(lowerName);
    }

    // Match: First letter of firstname + Full last name
    const parts = playerName.split(' ');
    if (parts.length >= 2) {
        const cricsheetFirstInitial = parts[0][0].toLowerCase(); // First letter only
        const cricsheetLastName = parts.slice(1).join(' ').toLowerCase(); // Full last name

        // Check all team lookup keys for a match
        for (const [fullOrShortName, team] of teamLookup.entries()) {
            const lookupParts = fullOrShortName.split(' ');
            if (lookupParts.length >= 2) {
                const lookupFirstInitial = lookupParts[0][0]; // First letter of firstname
                const lookupLastName = lookupParts.slice(1).join(' '); // Full last name

                // Match only if BOTH first initial AND full last name match exactly
                if (lookupFirstInitial === cricsheetFirstInitial && lookupLastName === cricsheetLastName) {
                    return team;
                }
            }
        }
    }

    return undefined;
};

const seedAllPlayers = async () => {
    try {
        console.log('🏏 IPL Database - Processing ALL Players from Match Data\n');
        await connectDB();

        console.log('🧹 Clearing existing players...');
        await Player.deleteMany({});
        console.log('✅ Cleared\n');

        buildNationalityAndTeamMap();

        const jsonDirs = [
            { path: 'tests_male_json', format: 'test', type: 'Test' },
            { path: 'odis_male_json', format: 'odi', type: 'ODI' },
            { path: 'it20s_male_json', format: 't20i', type: 'T20I' },
            { path: 't20s_male_json', format: 't20', type: 'T20' },
            { path: 'ipl_json', format: 'ipl', type: 'IPL' },
        ];

        const playersStatsMap = new Map<string, PlayerStats>();
        let totalFilesProcessed = 0;

        for (const dirInfo of jsonDirs) {
            const jsonDir = path.join(__dirname, '../../../', dirInfo.path);

            if (!fs.existsSync(jsonDir)) {
                console.log(`⚠️  Directory not found: ${dirInfo.path}, skipping...`);
                continue;
            }

            const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
            console.log(`📁 Processing ${dirInfo.type} (${dirInfo.path}): ${files.length} files`);

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(jsonDir, file), 'utf-8');
                    const matchData: CricsheetMatch = JSON.parse(content);

                    processMatch(matchData, playersStatsMap, dirInfo.format, dirInfo.type);

                    totalFilesProcessed++;

                    if (totalFilesProcessed % 1000 === 0) {
                        console.log(`   Processed ${totalFilesProcessed} matches... (${playersStatsMap.size} unique players)`);
                    }
                } catch (error) {
                    continue;
                }
            }

            console.log(`✅ Completed ${dirInfo.type} - ${playersStatsMap.size} total unique players\n`);
        }

        console.log(`✅ Total matches processed: ${totalFilesProcessed}`);
        console.log(`✅ Total unique players found: ${playersStatsMap.size}\n`);

        // Filter to keep only players with at least 1 IPL match OR in IPL 2026 list
        const ipl2026Names = new Set(IPL_2026_PLAYERS.map(p => p.name.toLowerCase()));

        const players = Array.from(playersStatsMap.values())
            .filter(p => {
                const hasIplData = p.ipl.matches > 0;
                const inIpl2026List = ipl2026Names.has(p.name.toLowerCase());
                return hasIplData || inIpl2026List;
            })
            .map(playerStats => {
                const role = determineRole(playerStats);
                const overallStats = calculateDetailedStats(playerStats.overall);
                const testStats = calculateDetailedStats(playerStats.test);
                const odiStats = calculateDetailedStats(playerStats.odi);
                const t20iStats = calculateDetailedStats(playerStats.t20i);
                const t20Stats = calculateDetailedStats(playerStats.t20);
                const iplStats = calculateDetailedStats(playerStats.ipl);

                const team = getTeam(playerStats.name);

                return {
                    name: playerStats.name,
                    role: role,
                    stats: overallStats,
                    testStats, odiStats, t20iStats, t20Stats, iplStats,
                    team: team,
                    cricsheetId: playerStats.cricsheetId || playerStats.name.replace(/\s+/g, '_'),
                    isSold: false,
                    formScore: calculateFormScore(playerStats),
                    valueScore: calculateValueScore(overallStats, role),
                    tier: determineTier(overallStats, iplStats, role),
                    nationality: playerStats.nationality,
                    isOverseas: playerStats.nationality !== 'India',
                    specialistRatings: {
                        deathBowler: calculateDeathBowlingIndex(playerStats),
                        powerplayBatter: calculatePowerplayBattingIndex(playerStats),
                        powerplayBowler: calculatePowerplayBowlingIndex(playerStats),
                        middleOrderAnchor: calculateMiddleOrderIndex(playerStats),
                        finisher: calculateFinisherIndex(playerStats),
                    },
                    recentForm: playerStats.recentMatches.slice(-10),
                };
            });

        // Filter to only include players in IPL_2026_PLAYERS list
        console.log(`\n🔍 Filtering players to match IPL 2026 list...`);
        console.log(`   Found ${players.length} players in match data`);

        const filteredPlayers = players.filter(player => isInIPL2026List(player.name));
        console.log(`   Matched ${filteredPlayers.length} players from IPL 2026 list`);

        // Remove duplicates by cricsheetId (keep the one with more data)
        const uniquePlayers = new Map<string, any>();
        filteredPlayers.forEach(player => {
            const existing = uniquePlayers.get(player.cricsheetId);
            if (!existing || player.stats.matches > existing.stats.matches) {
                uniquePlayers.set(player.cricsheetId, player);
            }
        });

        const finalPlayers = Array.from(uniquePlayers.values());
        console.log(`   After deduplication: ${finalPlayers.length} unique players\n`);

        // Add missing players from IPL 2026 list with empty stats
        console.log(`🔍 Checking for missing players without stats...`);
        const existingPlayerNames = new Set(
            finalPlayers.map(p => p.name.toLowerCase())
        );

        const emptyStats = {
            matches: 0, innings: 0, runs: 0, ballsFaced: 0,
            average: 0, strikeRate: 0, hundreds: 0, fifties: 0,
            fours: 0, sixes: 0, wickets: 0, economy: 0,
            bowlingAverage: 0, bowlingStrikeRate: 0
        };

        const missingPlayers: any[] = [];

        for (const player of IPL_2026_PLAYERS) {
            const lowerName = player.name.toLowerCase();

            // Check if player already exists (by exact name or by matching logic)
            let found = existingPlayerNames.has(lowerName);

            if (!found) {
                // Check with matching logic (first initial + last name)
                const parts = lowerName.split(' ');
                if (parts.length >= 2) {
                    const firstInitial = parts[0][0];
                    const lastName = parts.slice(1).join(' ');

                    for (const existingName of existingPlayerNames) {
                        const existingParts = existingName.split(' ');
                        if (existingParts.length >= 2) {
                            const existingInitial = existingParts[0][0];
                            const existingLastName = existingParts.slice(1).join(' ');

                            if (firstInitial === existingInitial && lastName === existingLastName) {
                                found = true;
                                break;
                            }
                        }
                    }
                }
            }

            if (!found) {
                const team = getTeam(player.name);
                missingPlayers.push({
                    name: player.name,
                    role: 'All-Rounder', // Default role for players without stats
                    stats: { ...emptyStats },
                    testStats: { ...emptyStats },
                    odiStats: { ...emptyStats },
                    t20iStats: { ...emptyStats },
                    t20Stats: { ...emptyStats },
                    iplStats: { ...emptyStats },
                    team: team,
                    cricsheetId: player.name.replace(/\s+/g, '_'),
                    isSold: false,
                    formScore: 0,
                    valueScore: 50, // Default value
                    tier: 'Uncapped',
                    nationality: player.nationality,
                    isOverseas: player.nationality !== 'India',
                    specialistRatings: {
                        deathBowler: 0,
                        powerplayBatter: 0,
                        powerplayBowler: 0,
                        middleOrderAnchor: 0,
                        finisher: 0,
                    },
                    recentForm: [],
                });
            }
        }

        console.log(`   Found ${missingPlayers.length} players without stats`);

        const allPlayers = [...finalPlayers, ...missingPlayers];
        console.log(`   Total players to insert: ${allPlayers.length}\n`);

        console.log(`💾 Inserting ${allPlayers.length} players into MongoDB...`);
        await Player.insertMany(allPlayers);

        printSummary(allPlayers);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

function processMatch(
    matchData: CricsheetMatch,
    playersMap: Map<string, PlayerStats>,
    format: string,
    matchType: string
) {
    const registry = matchData.info?.registry?.people || {};
    const teams = matchData.info?.players || {};
    const matchDate = matchData.info?.dates?.[0] || '';
    const venue = matchData.info?.venue || matchData.info?.city || 'Unknown';
    const isT20Format = format === 't20' || format === 't20i' || format === 'ipl';

    const playersInMatch = new Set<string>();

    // Initialize all players in the match
    for (const [teamName, playerNames] of Object.entries(teams)) {
        for (const playerName of playerNames) {
            if (!playersMap.has(playerName)) {
                playersMap.set(playerName, {
                    name: playerName,
                    nationality: guessNationality(playerName),
                    cricsheetId: registry[playerName],
                    overall: createEmptyFormatStats(),
                    test: createEmptyFormatStats(),
                    odi: createEmptyFormatStats(),
                    t20i: createEmptyFormatStats(),
                    t20: createEmptyFormatStats(),
                    ipl: createEmptyFormatStats(),
                    powerplayBatting: { runs: 0, balls: 0, fours: 0, sixes: 0 },
                    middleOverBatting: { runs: 0, balls: 0 },
                    deathBatting: { runs: 0, balls: 0, fours: 0, sixes: 0 },
                    powerplayBowling: { wickets: 0, balls: 0, runs: 0 },
                    middleOverBowling: { wickets: 0, balls: 0, runs: 0 },
                    deathBowling: { wickets: 0, balls: 0, runs: 0 },
                    recentMatches: [],
                });
            }
            playersInMatch.add(playerName);
        }
    }

        if (matchData.innings) {
        const matchBattingStats = new Map<string, { runs: number; balls: number; fours: number; sixes: number; isOut: boolean }>();
        const matchBowlingStats = new Map<string, { wickets: number; balls: number; runs: number }>();
        const battersOut = new Set<string>();

        for (const inning of matchData.innings) {
            for (const over of inning.overs || []) {
                const phase = getPhase(over.over);

                for (const delivery of over.deliveries || []) {
                    const batterName = delivery.batter;
                    const bowlerName = delivery.bowler;

                    // Track if batter was dismissed
                    if (delivery.wickets?.length) {
                        delivery.wickets.forEach(w => {
                            if (w.player_out) {
                                battersOut.add(w.player_out);
                            }
                        });
                    }

                    if (playersMap.has(batterName)) {
                        const ps = playersMap.get(batterName)!;
                        const fs = getFormatStats(ps, format);

                        fs.runs += delivery.runs.batter;
                        fs.ballsFaced += 1;
                        ps.overall.runs += delivery.runs.batter;
                        ps.overall.ballsFaced += 1;

                        if (delivery.runs.batter === 4) { fs.fours++; ps.overall.fours++; }
                        if (delivery.runs.batter === 6) { fs.sixes++; ps.overall.sixes++; }

                        if (isT20Format) {
                            if (phase === 'powerplay') {
                                ps.powerplayBatting.runs += delivery.runs.batter;
                                ps.powerplayBatting.balls += 1;
                                if (delivery.runs.batter === 4) ps.powerplayBatting.fours++;
                                if (delivery.runs.batter === 6) ps.powerplayBatting.sixes++;
                            } else if (phase === 'middle') {
                                ps.middleOverBatting.runs += delivery.runs.batter;
                                ps.middleOverBatting.balls += 1;
                            } else if (phase === 'death') {
                                ps.deathBatting.runs += delivery.runs.batter;
                                ps.deathBatting.balls += 1;
                                if (delivery.runs.batter === 4) ps.deathBatting.fours++;
                                if (delivery.runs.batter === 6) ps.deathBatting.sixes++;
                            }
                        }

                        if (!matchBattingStats.has(batterName)) {
                            matchBattingStats.set(batterName, { runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false });
                        }
                        const ms = matchBattingStats.get(batterName)!;
                        ms.runs += delivery.runs.batter;
                        ms.balls += 1;
                        if (delivery.runs.batter === 4) ms.fours++;
                        if (delivery.runs.batter === 6) ms.sixes++;
                    }

                    if (playersMap.has(bowlerName)) {
                        const ps = playersMap.get(bowlerName)!;
                        const fs = getFormatStats(ps, format);

                        fs.ballsBowled += 1;
                        fs.runsConceded += delivery.runs.total;
                        ps.overall.ballsBowled += 1;
                        ps.overall.runsConceded += delivery.runs.total;

                        if (delivery.wickets?.length) {
                            fs.wickets += delivery.wickets.length;
                            ps.overall.wickets += delivery.wickets.length;
                        }

                        if (isT20Format) {
                            if (phase === 'powerplay') {
                                ps.powerplayBowling.balls += 1;
                                ps.powerplayBowling.runs += delivery.runs.total;
                                if (delivery.wickets) ps.powerplayBowling.wickets += delivery.wickets.length;
                            } else if (phase === 'middle') {
                                ps.middleOverBowling.balls += 1;
                                ps.middleOverBowling.runs += delivery.runs.total;
                                if (delivery.wickets) ps.middleOverBowling.wickets += delivery.wickets.length;
                            } else if (phase === 'death') {
                                ps.deathBowling.balls += 1;
                                ps.deathBowling.runs += delivery.runs.total;
                                if (delivery.wickets) ps.deathBowling.wickets += delivery.wickets.length;
                            }
                        }

                        if (!matchBowlingStats.has(bowlerName)) {
                            matchBowlingStats.set(bowlerName, { wickets: 0, balls: 0, runs: 0 });
                        }
                        const ms = matchBowlingStats.get(bowlerName)!;
                        ms.balls += 1;
                        ms.runs += delivery.runs.total;
                        if (delivery.wickets) ms.wickets += delivery.wickets.length;
                    }
                }
            }
        }

        playersInMatch.forEach(playerName => {
            const ps = playersMap.get(playerName)!;
            const fs = getFormatStats(ps, format);

            fs.matches += 1;
            ps.overall.matches += 1;

            const bs = matchBattingStats.get(playerName);
            if (bs && bs.balls > 0) {
                fs.innings += 1;
                ps.overall.innings += 1;
                fs.highestScore = Math.max(fs.highestScore, bs.runs);
                ps.overall.highestScore = Math.max(ps.overall.highestScore, bs.runs);

                // Track not outs
                const wasOut = battersOut.has(playerName);
                if (!wasOut) {
                    fs.notOuts += 1;
                    ps.overall.notOuts += 1;
                }
            }

            ps.recentMatches.push({
                date: matchDate,
                runs: bs?.runs || 0,
                wickets: matchBowlingStats.get(playerName)?.wickets || 0,
                venue: venue,
            });

            if (ps.recentMatches.length > 20) {
                ps.recentMatches = ps.recentMatches.slice(-20);
            }
        });
    }
}

function getFormatStats(ps: PlayerStats, format: string): FormatStats {
    switch (format) {
        case 'test': return ps.test;
        case 'odi': return ps.odi;
        case 't20i': return ps.t20i;
        case 't20': return ps.t20;
        case 'ipl': return ps.ipl;
        default: return ps.overall;
    }
}

function getPhase(overNumber: number): 'powerplay' | 'middle' | 'death' {
    if (overNumber < 6) return 'powerplay';
    if (overNumber < 16) return 'middle';
    return 'death';
}

function determineRole(ps: PlayerStats): 'Batsman' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper' {
    const hasBatting = ps.overall.runs > 200 || ps.overall.innings > 10;
    const hasBowling = ps.overall.wickets > 10 || ps.overall.ballsBowled > 120;

    const keepers = ['MS Dhoni', 'KL Rahul', 'Rishabh Pant', 'Sanju Samson', 'Ishan Kishan',
                     'Q de Kock', 'Jos Buttler', 'H Klaasen', 'N Pooran', 'RR Gurbaz', 'JKS Sharma',
                     'Dhruv Jurel', 'Abhishek Porel', 'AT Carey', 'PA Patel'];
    if (keepers.some(k => ps.name.includes(k.split(' ')[ps.name.split(' ').length - 1]))) return 'Wicketkeeper';

    if (hasBatting && hasBowling) return 'All-Rounder';
    if (hasBowling) return 'Bowler';
    return 'Batsman';
}

function calculateDetailedStats(fs: FormatStats) {
    // Batting average = runs / (innings - notOuts), but avoid division by zero
    const dismissals = fs.innings - fs.notOuts;
    const avg = dismissals > 0 ? fs.runs / dismissals : (fs.innings > 0 ? fs.runs / fs.innings : 0);
    const sr = fs.ballsFaced > 0 ? (fs.runs / fs.ballsFaced) * 100 : 0;
    const econ = fs.ballsBowled > 0 ? (fs.runsConceded / fs.ballsBowled) * 6 : 0;
    const bAvg = fs.wickets > 0 ? fs.runsConceded / fs.wickets : 0;
    const bSr = fs.wickets > 0 ? fs.ballsBowled / fs.wickets : 0;

    return {
        matches: fs.matches, innings: fs.innings, runs: fs.runs, ballsFaced: fs.ballsFaced,
        average: Math.round(avg * 100) / 100, strikeRate: Math.round(sr * 100) / 100,
        hundreds: Math.floor(fs.highestScore / 100), fifties: Math.floor(fs.highestScore / 50),
        fours: fs.fours, sixes: fs.sixes, wickets: fs.wickets,
        economy: Math.round(econ * 100) / 100, bowlingAverage: Math.round(bAvg * 100) / 100,
        bowlingStrikeRate: Math.round(bSr * 100) / 100,
    };
}

function calculateDeathBowlingIndex(ps: PlayerStats): number {
    if (ps.deathBowling.balls < 30) return 0;
    const econ = (ps.deathBowling.runs / ps.deathBowling.balls) * 6;
    const wpm = (ps.t20.matches + ps.ipl.matches) > 0 ? ps.deathBowling.wickets / (ps.t20.matches + ps.ipl.matches) : 0;
    return Math.min(100, (Math.max(0, 100 - econ * 8) * 0.6 + wpm * 50 * 0.4));
}

function calculatePowerplayBattingIndex(ps: PlayerStats): number {
    if (ps.powerplayBatting.balls < 30) return 0;
    const sr = (ps.powerplayBatting.runs / ps.powerplayBatting.balls) * 100;
    const bp = ((ps.powerplayBatting.fours + ps.powerplayBatting.sixes) / ps.powerplayBatting.balls) * 100;
    return Math.min(100, (Math.min(100, sr * 0.6) * 0.7 + bp * 2 * 0.3));
}

function calculatePowerplayBowlingIndex(ps: PlayerStats): number {
    if (ps.powerplayBowling.balls < 30) return 0;
    const econ = (ps.powerplayBowling.runs / ps.powerplayBowling.balls) * 6;
    const wpm = (ps.t20.matches + ps.ipl.matches) > 0 ? ps.powerplayBowling.wickets / (ps.t20.matches + ps.ipl.matches) : 0;
    return Math.min(100, (Math.max(0, 100 - econ * 10) * 0.6 + wpm * 50 * 0.4));
}

function calculateMiddleOrderIndex(ps: PlayerStats): number {
    if (ps.middleOverBatting.balls < 50) return 0;
    const sr = (ps.middleOverBatting.runs / ps.middleOverBatting.balls) * 100;
    const con = ps.overall.innings > 5 ? Math.min(100, ps.overall.innings * 10) : 0;
    return Math.min(100, sr * 0.4 + con * 0.6);
}

function calculateFinisherIndex(ps: PlayerStats): number {
    if (ps.deathBatting.balls < 30) return 0;
    const sr = (ps.deathBatting.runs / ps.deathBatting.balls) * 100;
    const bp = ((ps.deathBatting.fours + ps.deathBatting.sixes) / ps.deathBatting.balls) * 100;
    return Math.min(100, (Math.min(100, sr * 0.5) * 0.7 + bp * 2.5 * 0.3));
}

function calculateFormScore(ps: PlayerStats): number {
    const last10 = ps.recentMatches.slice(-10);
    if (last10.length < 3) return 50;
    const tr = last10.reduce((s, m) => s + m.runs, 0);
    const tw = last10.reduce((s, m) => s + m.wickets, 0);
    return Math.round(Math.min(100, Math.min(50, tr / last10.length * 1.5) + Math.min(50, tw / last10.length * 15)));
}

function calculateValueScore(stats: any, role: string): number {
    return Math.round(Math.min(100, Math.min(40, stats.runs * 0.01) + Math.min(40, stats.wickets * 0.5) + Math.min(20, stats.matches * 0.5)));
}

function determineTier(os: any, is: any, role: string): string {
    const impact = os.runs + os.wickets * 25 + os.matches * 10;
    if (is.matches > 30 && impact > 4000) return 'Marquee';
    if (role === 'All-Rounder' && os.runs > 1000 && os.wickets > 30) return 'All-Rounder';
    if (role === 'Wicketkeeper') return 'Wicketkeeper';
    if (role === 'Bowler') return 'Bowler';
    if (role === 'Batsman') return 'Batter';
    return 'Uncapped';
}

function printSummary(players: any[]) {
    console.log('\n' + '='.repeat(80));
    console.log('📋 IPL PLAYER DATABASE - COMPLETE\n');

    const byNat: { [k: string]: number } = {};
    const byRole: { [k: string]: number } = {};
    const byTeam: { [k: string]: number } = {};

    players.forEach(p => {
        byNat[p.nationality] = (byNat[p.nationality] || 0) + 1;
        byRole[p.role] = (byRole[p.role] || 0) + 1;
        if (p.team) {
            byTeam[p.team] = (byTeam[p.team] || 0) + 1;
        }
    });

    console.log('By Nationality (Top 10):');
    Object.entries(byNat).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([n, c]) => {
        console.log(`   ${n}: ${c} players`);
    });

    console.log('\nBy Role:');
    Object.entries(byRole).forEach(([r, c]) => console.log(`   ${r}: ${c}`));

    console.log('\nIPL 2026 Team Squads:');
    Object.entries(byTeam).sort((a, b) => a[0].localeCompare(b[0])).forEach(([t, c]) => {
        console.log(`   ${t}: ${c} players`);
    });

    console.log('\nTop 10 IPL Run Scorers:');
    players.sort((a, b) => b.iplStats.runs - a.iplStats.runs).slice(0, 10).forEach((p, i) => {
        const teamInfo = p.team ? ` [${p.team}]` : '';
        console.log(`   ${i + 1}. ${p.name.padEnd(25)} - ${p.iplStats.runs}R in ${p.iplStats.matches}M${teamInfo}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Database ready with ${players.length} IPL players!\n`);
}

seedAllPlayers();
