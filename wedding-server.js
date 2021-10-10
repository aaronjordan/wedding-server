require('dotenv').config();
const path = require('path');
const {readdir} = require('fs/promises');
const express = require('express');
const cookieParser = require('cookie-parser');
const { 
  constants: DB_CONSTANTS, 
  closeOnFailedQuery, 
  initDB,
  findWithin,
  validateUserSession,
} = require('./db-helpers');

const app = express();

const DEV = process.env.DEV || false;
const PORT = process.env.PORT || null;
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || null;
const BASE_MEDIA_DIR = process.env.BASE_MEDIA_DIR || path.join(__dirname, 'media');
if(PORT === null || IMAGE_BASE_URL === null) throw Error;

app.use(express.static(path.join(__dirname, 'client')));
app.use(cookieParser());
app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

app.get(`${IMAGE_BASE_URL}/list`, async (req, res) => {
  const files = await readdir(BASE_MEDIA_DIR);

  const dataRes = files.reduce((acc, next) => {
    next = String(next);
    // only process images
    if(next.slice(next.lastIndexOf('.')) !== '.jpg') {
      return acc;
    }

    // add key for label if not present
    const nextLabel = next.slice(0,next.indexOf('-'));
    if(!Object.keys(acc).includes(nextLabel)) {
      Object.defineProperty(acc, nextLabel, {
        value: {},
        writable: true,
        enumerable: true
      });
    }

    // add inner key for quality of this filename
    const nextQuality = next.slice(next.indexOf('-')+1, next.lastIndexOf('.'));
    Object.defineProperty(acc[nextLabel], nextQuality, {
      value: `${IMAGE_BASE_URL}/${nextLabel}?q=${nextQuality}`,
      enumerable: true
    })

    return acc;
  }, {});

  res.type('json').send(dataRes);
});

app.get(`${IMAGE_BASE_URL}/:imgLabel`, async (req, res) => {
  const label = req.params.imgLabel;
  const quality = req.query.q || 'lq';
  const filename = `${label}-${quality}.jpg`;

  const files = await readdir(BASE_MEDIA_DIR);

  if(files.includes(filename)) {
    res.type('jpg').sendFile(path.join(BASE_MEDIA_DIR, filename));
  } else {
    res.type('text').status(404)
      .send('Error 404: The requested image cannot be found.');
  }
});

app.get('/node/rsvp/self', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);

  const instance = initDB(DB_CONSTANTS.RSVP_RW);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  const socialEmail = req.cookies.login_email || '';
  const name = req.cookies.login_name?.toLocaleLowerCase() || '';

  // try social_email match shortcut
  const socialConnect = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.PERSON_BY_SOCIAL_EMAIL).get({
      $email: socialEmail
    }, (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (socialConnect === DB_CONSTANTS.FAILURE_CODE) return false;
  else if (socialConnect?.id) {
    res.json({
      status: 'ok', 
      self: socialConnect, 
    });
    instance.close();
    return;
  }
  
  // find if login email is associated with a contact_group
  let contactGroup = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GROUP_BY_EMAIL).get({
        $email: socialEmail
      }, (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (contactGroup === DB_CONSTANTS.FAILURE_CODE) return false;
  //TODO: should we do something with the verified_email field?

  // find if login_name is associated with a people row
  // use login_name to filter number of names returned. only return if either 
  // substring (typically first, last) from login_name is found
  let dbPeople = await new Promise((resolve, reject) => {
    const splitName = name.split(' ');
    instance.prepare(DB_CONSTANTS.ALL_PEOPLE_WITH_NAME).all({
        $name_begin: `%${splitName[0]}%`, $name_end: `%${splitName[splitName.length-1]}%`
      }, (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)
    ).finalize();
  })
  
  let similarPeople = dbPeople.map(person => {
    person.first = String(person.first).toLocaleLowerCase();
    person.middle = String(person.middle).toLocaleLowerCase();
    person.last = String(person.last).toLocaleLowerCase();
    return person;
  });
  if (similarPeople === DB_CONSTANTS.FAILURE_CODE) return false;
  // work on the below... is object result...
  // similarPeople = similarPeople.map(n => n.toLocaleLowerCase()); // lowercase for compare

  // immediately invoked function will return one match {} or null if no match is found
  const person = (() => {
    if(contactGroup && contactGroup.id) {
      // name must match member of group. easier.
      const peopleWithGroupId = similarPeople
        .filter(user => user.contact_group && user.contact_group === contactGroup.id);
      if (peopleWithGroupId.length === 1) return peopleWithGroupId[0];
      else if (peopleWithGroupId.length === 0) return null;
      else {
        const peopleWithGroupIdAndName = similarPeople
          .filter(user => user.contact_group && user.contact_group === contactGroup.id)
          .filter(user => (findWithin(name, user.first?.[0]) || findWithin(name, user.middle?.[0])) && findWithin(name, user.last));
        if (peopleWithGroupIdAndName.length === 1) return peopleWithGroupIdAndName[0];
        else if (peopleWithGroupIdAndName.length === 0) return null;
        else {
          // these searches will return the first element, whic will either be a user object or a null
          const firstNameFilter = peopleWithGroupIdAndName.filter(user => findWithin(name, user.first)).push(null)[0];
          const middleNameFilter = peopleWithGroupIdAndName.filter(user => findWithin(name, user.middle)).push(null)[0];
          return firstNameFilter || middleNameFilter; /// prefer first name match
        }
      }
    } else {
      let nameResult = similarPeople // match at least John Harold Doe
        .filter(user => findWithin(name, user.first) && findWithin(name, user.middle) && findWithin(name, user.last));
      if (nameResult.length === 0) nameResult = similarPeople // match John Doe
        .filter(user => findWithin(name, user.first) && findWithin(name, user.last));
      if (nameResult.length === 0) nameResult = similarPeople // match Harold Doe
        .filter(user => findWithin(name, user.middle) && findWithin(name, user.last));
      // if (nameResult.length === 0) nameResult = similarPeople // match J Doe or H Doe
      //   .filter(user => (findWithin(name, user.first?.[0]) || findWithin(name, user.middle?.[0])) && findWithin(name, user.last));
      // otherwise we cannot reasonably identify the user with login_name
      return nameResult.length > 0 ? nameResult[0] : null;
    }
  })();

  // record social_email to speed up any more /self calls by this user if a person was found
  let updateResult = person?.id && await new Promise((resolve, reject) => {
    console.log(`Recording new social email for user logged into ${person.id} with name ${name} as ${socialEmail}`);
    instance.prepare(DB_CONSTANTS.UPDATE_SOCIAL_EMAIL).run({
        $email: socialEmail, $id: person.id
      }, (err) => resolve(err ? closeOnFailedQuery(instance, res) : true)
    ).finalize();
  });
  if (updateResult === DB_CONSTANTS.FAILURE_CODE) return false;

  res.json({
    status: 'ok',
    self: dbPeople.find(dbPerson => person?.id === dbPerson?.id),
  });
  instance.close();
});

app.post('/node/rsvp/self', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
  const instance = initDB(DB_CONSTANTS.RSVP_RW);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  const socialEmail = req.cookies.login_email || '';
  const { id=-1, inPerson=null } = req.body || {};

  // try social_email match shortcut
  const validation = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.VALIDATE_PERSON_BY_EMAIL).get({
      $email: socialEmail,
      $id: id
    }, (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (validation === DB_CONSTANTS.FAILURE_CODE) return false;
  else if (!validation.result) {
    res.sendStatus(500);
    instance.close();
    return false;
  }

  let updateResult = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.UPDATE_IN_PERSON).get({
        $inPerson: inPerson, $id: id
      }, (err) => resolve(err ? closeOnFailedQuery(instance, res) : true)
    ).finalize();
  });
  if (updateResult === DB_CONSTANTS.FAILURE_CODE) return false;
  else console.log(`self updated user with id ${id}`);

  res.json({
    status: 'ok',
    inPerson: inPerson
  });
  instance.close();
});

app.get('/node/rsvp/group', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
  const instance = initDB(DB_CONSTANTS.RSVP_R);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  const socialEmail = req.cookies.login_email || '';
  const id = req.query.id || 0;

  // use social_email for match
  const self = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.PERSON_BY_SOCIAL_EMAIL).get({
      $email: socialEmail
    }, (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (self === DB_CONSTANTS.FAILURE_CODE) return false;
  else if (!self?.id) {
    closeOnFailedQuery(instance, res, `Social email mismatch for ${socialEmail}: no user found`);
    return;
  }

  // validate user login exists within server table

  const contact_group = self.contact_group || 0;

  // get group members of contact_group
  const groupMembers = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GROUP_RSVPS_FROM_GROUP_ID).all({
      $contactGroup: contact_group,
      $id: id,
    }, (err, rows) => resolve(err ? closeOnFailedQuery(instance, res) : rows)).finalize();
  });
  if (groupMembers === DB_CONSTANTS.FAILURE_CODE) return false;

  res.json({
    status: 'ok',
    group: groupMembers
  });
  instance.close();
});

app.post('/node/rsvp/group', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
  const updates = req.body;
  if(!(updates instanceof Array) || updates.length === 0)
    return res.sendStatus(400);

  const instance = initDB(DB_CONSTANTS.RSVP_RW);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  const socialEmail = req.cookies.login_email || '';

  // look up user with social_email
  const self = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.PERSON_BY_SOCIAL_EMAIL).get({
      $email: socialEmail
    }, (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (self === DB_CONSTANTS.FAILURE_CODE) return false;

  // get group members of contact_group
  let groupMembers = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GROUP_RSVPS_FROM_GROUP_ID).all({
      $contactGroup: self.contact_group, $id: 0,
    }, (err, rows) => resolve(err ? closeOnFailedQuery(instance, res) : rows)).finalize();
  });
  if (groupMembers === DB_CONSTANTS.FAILURE_CODE) return false;

  // check that all users affected by the request are in the logged-in user's contact group
  const groupMemberIDs = groupMembers.map(user => user.id);
  const onlyContactGroupUpdates = updates.reduce((acc, update) => groupMemberIDs.indexOf(update.id) !== -1 && acc, true);

  // if user is only modifying those in their contact group, then allow
  if (onlyContactGroupUpdates) {
    const dispatchUpdate = (params) => {
      return new Promise((resolve, reject) => {
        instance.prepare(DB_CONSTANTS.UPDATE_IN_PERSON_BULK).get({
          $inPerson: params.in_person, $id: params.id, $userId: self.id
        }, (err, rows) => resolve(err ? closeOnFailedQuery(instance, res) : rows)).finalize();
      });
    };

    const updatePromises = updates.map(params => dispatchUpdate(params));
    await Promise.all(updatePromises);

    // check whole array for any failure codes
    if (updatePromises.some(x => x === DB_CONSTANTS.FAILURE_CODE)) return false;
    console.log(`updated group ${self.contact_group} by user with id ${self.id}`);
  } else {
    res.status(403).send('Error: Unauthorized operation with global table scope.');
    instance.close();
    return false;
  }

  res.json({
    status: 'ok'
  });
  instance.close();
});

app.all('/node/rsvp/register', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);

  const instance = initDB(DB_CONSTANTS.RSVP_RW);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  const name = req.cookies.login_name || '';
  const email = req.cookies.login_email || '';

  const dbEmail = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.CHECK_IF_REGISTERED).get({
      $email: email,
    }, (err, rows) => resolve(err ? closeOnFailedQuery(instance, res) : rows)).finalize();
  });
  if (dbEmail === DB_CONSTANTS.FAILURE_CODE) return false;

  if(typeof dbEmail == 'object' && dbEmail.email) {
    res.json({result: 'found'});
  } else if (String(req.query.create) === 'true') {
    const dbWrite = await new Promise((resolve, reject) => {
      instance.prepare(DB_CONSTANTS.REGISTER_NEW_PERSON).run({
        $email: email, $name: name
      }, (err) => resolve(err ? closeOnFailedQuery(instance, res) : true)).finalize();
    });
    if (dbWrite === DB_CONSTANTS.FAILURE_CODE) return false;

    res.json({result: 'created'});
  } else {
    res.json({result: 'not found'})
  }
});

app.get('/node/admin/people', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
    
  const socialEmail = req.cookies.login_email || '';
  if (!String(process.env.ADMIN_EMAIL).includes(socialEmail))
    return res.sendStatus(403);
  
  const instance = initDB(DB_CONSTANTS.RSVP_R);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  // view table of invitees
  const people = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GET_PEOPLE).all(
      (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (people === DB_CONSTANTS.FAILURE_CODE) return false;

  res.json({
    status: 'ok',
    people
  });
  instance.close();
});

app.get('/node/admin/sessions', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
    
  const socialEmail = req.cookies.login_email || '';
  if (!String(process.env.ADMIN_EMAIL).includes(socialEmail))
    return res.sendStatus(403);
  
  const instance = initDB(DB_CONSTANTS.RSVP_R);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  // view table of invitees
  const people = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GET_SESSIONS).all(
      (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (people === DB_CONSTANTS.FAILURE_CODE) return false;

  res.json({
    status: 'ok',
    sessions: people.map(x => x.login_email)
  });
  instance.close();
});

app.get('/node/admin/new-people', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
    
  const socialEmail = req.cookies.login_email || '';
  if (!String(process.env.ADMIN_EMAIL).includes(socialEmail))
    return res.sendStatus(403);
  
  const instance = initDB(DB_CONSTANTS.RSVP_R);
  if(!instance) return res.status(500).send('Error DB001: Connection not available');

  // view table of invitees
  const people = await new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GET_REGISTRATIONS).all(
      (err, row) => resolve(err ? closeOnFailedQuery(instance, res) : row)).finalize();
  });
  if (people === DB_CONSTANTS.FAILURE_CODE) return false;

  res.json({
    status: 'ok',
    newPeople: people
  });
  instance.close();
});

app.get('/node/user-type', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);
    
  const socialEmail = req.cookies.login_email || '';
  const adminUserList = String(process.env.ADMIN_EMAIL).split(',');
  const isAdmin = adminUserList.includes(socialEmail);

  res.json({
    status: 'ok',
    admin: isAdmin
  });
});

DEV && app.get('/node/logRequest', (req, res) => {
  console.log(req.cookies);
  res.json(req.cookies);
});

DEV && app.get('/node/testAuthCode', async (req, res) => {
  if(!(await validateUserSession(req.cookies)))
    return res.sendStatus(401);

  const match = await validateUserSession(req.cookies);

  res.json({
    result: match,
  });
});

DEV && app.get('/node/testDBAccess', async (req, res) => {
  if(!req.cookies.login_email || !req.cookies.login_name)
    return res.sendStatus(401); 
  const instance = initDB(DB_CONSTANTS.RSVP_R);
  if(!instance) return res.sendStatus(500);

  const resultSet = new Promise((resolve, reject) => {
    instance.prepare(DB_CONSTANTS.GET_PEOPLE).all( 
      (err, rows) => {
        if(err) return res.sendStatus(500);
        resolve(rows);
      }).finalize();
  });

  res.json(await resultSet);
  instance.close();
});

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

app.listen(PORT, () => console.log('server is alive on '+PORT));