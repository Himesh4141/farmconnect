import { openDatabase } from './db.js';
const [action,email]=process.argv.slice(2);
if(!['grant','revoke'].includes(action)||!email){console.error('Usage: node --env-file-if-exists=.env src/admin-cli.js grant|revoke email@example.com');process.exitCode=1;}
else{
 const db=openDatabase();
 try{
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase());
  if(!user)throw new Error('No account with this email. Register in Farmconnect first.');
  if(action==='grant'&&db.prepare('SELECT 1 FROM delivery_partners WHERE user_id=?').get(user.id))throw new Error('Delivery accounts cannot be administrators. Use a separate administrator account.');
  if(action==='grant')db.prepare('INSERT INTO admin_users(user_id) VALUES (?) ON CONFLICT DO NOTHING').run(user.id);
  else db.prepare('DELETE FROM admin_users WHERE user_id=?').run(user.id);
  console.log(action==='grant'?'Admin access enabled. Refresh Farmconnect and open My account.':'Admin access removed.');
 }catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
}
