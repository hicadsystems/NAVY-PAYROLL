//administration
const usersRoutes = require('./administration/users');
const rolesRoutes = require('./administration/roles');

//utilities
const backupRoutes = require('./utilities/backup-db');
const restoreRoutes = require('./utilities/restore-db');

//refrence tables
const statesRoutes = require('./refrence-tables/states');
const payelementsRoutes = require('./refrence-tables/payelements');


module.exports = (app) => {
    //administration
    app.use('/api/users', usersRoutes);
    app.use('/', rolesRoutes);

    //utilities
    app.use('/api/backup-db', backupRoutes);
    app.use("/api/restore-db", restoreRoutes);

    //refrence tables
    app.use("/", statesRoutes);
    app.use("/", payelementsRoutes);

};