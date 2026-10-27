import mongoose from 'mongoose';
import { env } from './env.js';
export let mongoReady=false;
export async function connectDb(){if(!env.mongoUri){console.warn('MONGODB_URI not set; using in-memory case repository.');return}try{await mongoose.connect(env.mongoUri,{serverSelectionTimeoutMS:2500});mongoReady=true;console.log('MongoDB connected')}catch(e){console.warn('MongoDB unavailable; using in-memory case repository.',e instanceof Error?e.message:'')}}
