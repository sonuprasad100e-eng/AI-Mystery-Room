import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id:{type:String,required:true},
  userPrompt:String,difficulty:String,title:String,caseNumber:String,crimeType:String,setting:String,incidentTimestamp:String,
  victim:mongoose.Schema.Types.Mixed,briefing:String,timelineSummary:[String],suspects:[mongoose.Schema.Types.Mixed],evidence:mongoose.Schema.Types.Mixed,
  solution:mongoose.Schema.Types.Mixed,status:{type:String,default:'unsolved'},attemptsCount:{type:Number,default:0}
},{timestamps:{createdAt:true,updatedAt:false},strict:false});
export const CaseModel = mongoose.models.Case || mongoose.model('Case',schema);
