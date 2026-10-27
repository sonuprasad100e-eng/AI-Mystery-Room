import { connectDb } from './config/db.js';import { CaseModel } from './models/Case.model.js';import { seedCase } from './services/seedCase.js';
await connectDb();await CaseModel.findByIdAndUpdate(seedCase._id,seedCase,{upsert:true,new:true});console.log(`Seeded ${seedCase.caseNumber}`);process.exit(0);
