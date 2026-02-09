import { hash as _hash } from 'bcrypt';

const adminPassword = process.argv[2] || 'neigus1122';

_hash(adminPassword, 10).then(hash => {
  console.log('Admin Password Hash:');
  console.log(hash);
  console.log('\nAdd this to your .env file as ADMIN_PASSWORD_HASH');
}).catch(err => console.error(err));