const sqlite3 = require('sqlite3').verbose();
const md5 = require('md5');
const RSVP_DB_URL = process.env.RSVP_DB_URL || null; 
const FAILURE_CODE = 'DB002';
const CANONICAL_HOST = 'https://mazlinandaaron.com';
const GET_MATCH_MD5 = 'SELECT key FROM session WHERE key=$code AND login_email=$email'

const RSVP_R = Object.freeze({
  url: RSVP_DB_URL,
  plugin: sqlite3,
  protocol: sqlite3.OPEN_READONLY
});

const helpers = Object.freeze({

  /**
   * A list of DB-related constants to be used elsewhere
   */
  constants: Object.freeze({

    // literals
    FAILURE_CODE, 
    CANONICAL_HOST,

    // standard read statements
    GROUP_BY_EMAIL: 'SELECT id, verified_email FROM contact_groups WHERE email=$email',
    ALL_PEOPLE_WITH_NAME: 'SELECT id, contact_group, stream_only, first, middle, last, rsvp_received FROM people WHERE full_name LIKE $name_begin OR full_name LIKE $name_end', 
    PERSON_BY_SOCIAL_EMAIL: 'SELECT * FROM people WHERE social_email=$email',
    VALIDATE_PERSON_BY_EMAIL: 'SELECT social_email=$email AND id=$id AS result FROM people WHERE social_email=$email',
    GROUP_RSVPS_FROM_GROUP_ID: 'SELECT id, full_name, rsvp_completed, rsvp_received, in_person, stream_only FROM people WHERE contact_group=$contactGroup AND NOT (id=$id)',
    GET_PEOPLE: 'SELECT people.*, contact_groups.email, contact_groups.verified_email, contact_groups.address FROM people LEFT JOIN contact_groups ON people.contact_group=contact_groups.id',

    // standard write statements
    UPDATE_SOCIAL_EMAIL: 'UPDATE people SET social_email=$email, id=$id WHERE id=$id',
    UPDATE_IN_PERSON: 'UPDATE people SET in_person=$inPerson, id=$id, rsvp_completed=1, rsvp_received=1 WHERE id=$id',
    UPDATE_IN_PERSON_BULK: 'UPDATE people SET in_person=$inPerson, id=$id, rsvp_completed=(id=$userId), rsvp_received=1 WHERE id=$id',

    // config objects
    RSVP_RW: Object.freeze({
      url: RSVP_DB_URL,
      plugin: sqlite3,
      protocol: sqlite3.OPEN_READWRITE
    }),
    RSVP_R,

  }),

  /**
   * A function to initialize the DB connection.
   * @param {object} config the data to set up with
   */
  initDB: (config={}) => {
    if(!config.url) return null;
    const db = new config.plugin.Database(config.url, config.protocol || undefined, err => {
      return null;
    });
    return db;
  },

  /**
   * A helper to close a DB connection and fail the request when a query fails with an error.
   */
  closeOnFailedQuery: (instance, res, logMessage=false) => {
    !logMessage && console.error('DB ERROR...')
    typeof logMessage === 'string' && console.error(logMessage);
    instance.close();
    res.status(500).send('Error DB002: Internal Server Error');
    return FAILURE_CODE;
  },

  /**
   * A string helper so that running String.includes() will not return true if the 
   * input argument is a falsy '' from the database.
   */
  findWithin: (str, sub) => sub && str.includes(sub),

  /**
   * Will quickly validate a user's session by verifying the cookies are as expected.
   * Uses md5 hashing to generate a temporary password at during any login
   * @param {object} cookies the current session cookies
   */
  validateUserSession: async (cookies) => {
    if(!cookies.login_email || !cookies.login_name || !cookies.login_id)
      return false;
    const name = encodeURIComponent(cookies.login_name || '');
    const email = encodeURIComponent(cookies.login_email || '');
  
    const codedString = `${name}TO${email}INTO${CANONICAL_HOST}`;
    const thisHash = md5(codedString);
    console.log('hash to ' + thisHash)

    const matchesSelf = thisHash === cookies.login_id;
    if(!matchesSelf) return false;

    const instance = new RSVP_R.plugin.Database(RSVP_R.url, RSVP_R.protocol || undefined, err => {
      return null;
    }); if(!instance) return null;
    console.log(instance)

    const dbMatch = await new Promise((resolve, reject) => {
      instance.get(GET_MATCH_MD5, {
        $code: thisHash,
        $email: cookies.login_email
      }, (err, row) => resolve(err ? null : row));
    });
    console.log(dbMatch);

    instance.close();
    return dbMatch && dbMatch.key === thisHash;
  },
});

module.exports = helpers;