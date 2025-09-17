//administration
const usersRoutes = require('./administration/users');
const rolesRoutes = require('./administration/roles');
const switchpayrollclassRoutes = require('./administration/switchpayrollclass');

//utilities
const backupRoutes = require('./utilities/backup-db');
const restoreRoutes = require('./utilities/restore-db');

//refrence tables
const statesRoutes = require('./refrence-tables/states');
const payelementsRoutes = require('./refrence-tables/payelements');
const overtimeRoutes = require('./refrence-tables/overtime');
const bankdetailsRoutes = require('./refrence-tables/bankdetails');


module.exports = (app) => {
    //administration
    app.use('/api/users', usersRoutes);
    app.use('/', rolesRoutes);
    app.use('/', switchpayrollclassRoutes);

    //utilities
    app.use('/api/backup-db', backupRoutes);
    app.use("/api/restore-db", restoreRoutes);

    //refrence tables
    app.use("/", statesRoutes);
    app.use("/", payelementsRoutes);
    app.use("/", overtimeRoutes);
    app.use("/api", bankdetailsRoutes);
};