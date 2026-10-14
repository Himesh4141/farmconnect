import { openDatabase } from './db.js';
const [action,email]=process.argv.slice(2);
if(!['approve','suspend'].includes(action)||!email){
 console.error('Usage: node --env-file-if-exists=.env src/delivery-cli.js approve|suspend delivery-email');process.exitCode=1;
}else{
 const db=openDatabase();
 try{
  db.exec('BEGIN IMMEDIATE');
  const partner=db.prepare('SELECT d.user_id FROM delivery_partners d JOIN users u ON u.id=d.user_id WHERE u.email=?').get(email.trim().toLowerCase());
  if(!partner)throw new Error('Create a dedicated delivery account at /delivery first. Consumer accounts cannot be converted here.');
  db.prepare('UPDATE delivery_partners SET status=? WHERE user_id=?').run(action==='approve'?'approved':'suspended',partner.user_id);
  if(action==='suspend')db.prepare("UPDATE demo_shipments SET assigned_to=NULL,revision=revision+1 WHERE assigned_to=? AND status='pickup_requested'").run(partner.user_id);
  db.prepare('INSERT INTO delivery_access_events(user_id,action,created_at) VALUES (?,?,?)').run(partner.user_id,action,Date.now());
  db.exec('COMMIT');console.log(action==='approve'?'Delivery access approved. Refresh /delivery. No admin access was granted.':'Delivery access suspended. Uncollected jobs released; collected jobs stay assigned for review.');
 }catch(error){db.exec('ROLLBACK');console.error(error.message);process.exitCode=1;}finally{db.close();}
}
