//administration
const usersRoutes = require('./administration/users');
const rolesRoutes = require('./administration/roles');
const switchpayrollclassRoutes = require('./administration/switchpayrollclass');


//Personnel Profile



//utilities
const backupRoutes = require('./utilities/backup-db');
const restoreRoutes = require('./utilities/restore-db');



//refrence tables
const statesRoutes = require('./refrence-tables/states');
const payelementsRoutes = require('./refrence-tables/payelements');
const overtimeRoutes = require('./refrence-tables/overtime');
const bankdetailsRoutes = require('./refrence-tables/bankdetails');
const localgovernmentRoutes = require('./refrence-tables/localgovernment');
const departmentRoutes = require('./refrence-tables/department');
const commandRoutes = require('./refrence-tables/command');
const taxRoutes = require('./refrence-tables/tax');
const payperrankRoutes = require('./refrence-tables/payperrank');
const mutuallyexclusiveRoutes = require('./refrence-tables/mutuallyexclusive');
const salaryscaleRoutes = require('./refrence-tables/salaryscale');
const pfaRoutes = require('./refrence-tables/pfa');



//file-upload-helper
const salaryscaleuploadRoutes = require('./file-upload-helper/salaryscaleupload');



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
    app.use("/pay", payelementsRoutes);
    app.use("/", overtimeRoutes);
    app.use("/api/v1", salaryscaleRoutes);
    app.use("/api/tax", taxRoutes);
    app.use("/api", bankdetailsRoutes);
    app.use("/lg", localgovernmentRoutes);
    app.use("/dept", departmentRoutes);
    app.use("/cmd", commandRoutes);
    app.use("/rank", payperrankRoutes);
    app.use("/mutually", mutuallyexclusiveRoutes);
    app.use("/pfa", pfaRoutes)
    


    //file-upload-helper
    app.use("/api/v1", salaryscaleuploadRoutes);
};