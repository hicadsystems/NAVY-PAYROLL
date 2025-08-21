// router/reference-tables.js
const poolPromise = require('../db');

async function runQuery(query, params = []) {
  const pool = await poolPromise;
  const request = pool.request();
  params.forEach(p => request.input(p.name, p.type, p.value));
  const result = await request.query(query);
  return result.recordset;
}

async function getOvertimeRates() {
  return runQuery("SELECT * FROM py_stdrate WHERE type='BT03'");
}

// insert or update overtime record
async function saveOvertimeRate(data) {
  const query = `
    MERGE py_stdrate AS target
    USING (SELECT @type AS type) AS src
    ON (target.type = src.type)
    WHEN MATCHED THEN
      UPDATE SET stdfix=@stdfix, ord=@ord, sat=@sat, sun=@sun, pub=@pub, shift=@shift,
                 relay=@relay, basicpay=@basicpay, mth=@mth, pmth=@pmth, createdby=@createdby
    WHEN NOT MATCHED THEN
      INSERT (type, stdfix, ord, sat, sun, pub, shift, relay, basicpay, mth, pmth, createdby)
      VALUES (@type, @stdfix, @ord, @sat, @sun, @pub, @shift, @relay, @basicpay, @mth, @pmth, @createdby);
  `;

  return runQuery(query, [
    { name: 'type', type: require('mssql').VarChar, value: data.type },
    { name: 'stdfix', type: require('mssql').VarChar, value: data.stdfix },
    { name: 'ord', type: require('mssql').Float, value: data.ord },
    { name: 'sat', type: require('mssql').Float, value: data.sat },
    { name: 'sun', type: require('mssql').Float, value: data.sun },
    { name: 'pub', type: require('mssql').Float, value: data.pub },
    { name: 'shift', type: require('mssql').Float, value: data.shift },
    { name: 'relay', type: require('mssql').Float, value: data.relay },
    { name: 'basicpay', type: require('mssql').Float, value: data.basicpay },
    { name: 'mth', type: require('mssql').Float, value: data.mth },
    { name: 'pmth', type: require('mssql').Float, value: data.pmth },
    { name: 'createdby', type: require('mssql').VarChar, value: data.createdby },
  ]);
}

/* ---------------- Salary Groups ---------------- */
async function getSalaryGroups() {
  return runQuery(
    `SELECT groupcode, effdate, lastdate, grpdesc 
     FROM py_salarygroup`,
    [],
    "HicadData"
  );
}

async function saveSalaryGroup(data) {
  const query = `
    INSERT INTO [HicadData].[dbo].[py_salarygroup]
      (groupcode, grpdesc, effdate, lastdate)
    VALUES (@groupcode, @grpdesc, @effdate, @lastdate)
  `;
  return runQuery(query, [
    { name: "groupcode", value: data.groupcode },
    { name: "grpdesc", value: data.grpdesc },
    { name: "effdate", value: data.effdate },
    { name: "lastdate", value: data.lastdate }
  ], "HicadData");
}

async function updateSalaryGroup(data) {
  const query = `
    UPDATE [HicadData].[dbo].[py_salarygroup]
    SET effdate = @effdate, lastdate = @lastdate, grpdesc = @grpdesc
    WHERE groupcode = @groupcode
  `;
  return runQuery(query, [
    { name: "groupcode", value: data.groupcode },
    { name: "effdate", value: data.effdate },
    { name: "lastdate", value: data.lastdate },
    { name: "grpdesc", value: data.grpdesc }
  ], "HicadData");
}

async function deleteSalaryGroup(code) {
  return runQuery(
    `DELETE FROM py_salarygroup WHERE groupcode = @p0`,
    [code],
    "HicadData"
  );
}

/* ---------------- Element Types ---------------- */
async function getElementTypes() {
  return runQuery(
    `SELECT PaymentType, elmDesc, Ledger, perc, std, maxi, bpay, yearend, Status, dependence, payfreq, pmonth, freetax
     FROM py_elementType`,
    [],
    "HicadPension"
  );
}

/* ---------------- Grade Levels ---------------- */
async function getGradeLevels() {
  return runQuery(
    `SELECT No, gradedesc
     FROM py_gradelevel`,
    [],
    "HicadPension"
  );
}

/* ---------------- Salary Scale ---------------- */
async function getSalaryScales() {
  return runQuery(
    `SELECT salcode, saltype, grade, step1, step2, step3, step4, step5, step6, step7, step8, step9, step10,
            step11, step12, step13, step14, step15, step16, step17, step18, step19, step20, [user]
     FROM py_salaryscale`,
    [],
    "HicadData"
  );
}

async function saveSalaryScale(data) {
  const query = `
    INSERT INTO py_salaryscale (
      salcode, saltype, grade, step1, step2, step3, step4, step5, step6, step7, step8, step9,
      step10, step11, step12, step13, step14, step15, step16, step17, step18, step19, step20, [user]
    )
    VALUES (
      @p0,@p1,@p2,@p3,@p4,@p5,@p6,@p7,@p8,@p9,@p10,@p11,
      @p12,@p13,@p14,@p15,@p16,@p17,@p18,@p19,@p20,@p21,@p22,@p23
    )
  `;
  return runQuery(query, [
    data.salcode, data.saltype, data.grade,
    data.step1, data.step2, data.step3, data.step4, data.step5,
    data.step6, data.step7, data.step8, data.step9, data.step10,
    data.step11, data.step12, data.step13, data.step14, data.step15,
    data.step16, data.step17, data.step18, data.step19, data.step20,
    data.user
  ], "HicadData");
}

async function updateSalaryScale(data) {
  const query = `
    UPDATE py_salaryscale
    SET saltype=@p1, grade=@p2, step1=@p3, step2=@p4, step3=@p5, step4=@p6, step5=@p7,
        step6=@p8, step7=@p9, step8=@p10, step9=@p11, step10=@p12,
        step11=@p13, step12=@p14, step13=@p15, step14=@p16, step15=@p17,
        step16=@p18, step17=@p19, step18=@p20, step19=@p21, step20=@p22,
        [user]=@p23
    WHERE salcode=@p0
  `;
  return runQuery(query, [
    data.salcode, data.saltype, data.grade,
    data.step1, data.step2, data.step3, data.step4, data.step5,
    data.step6, data.step7, data.step8, data.step9, data.step10,
    data.step11, data.step12, data.step13, data.step14, data.step15,
    data.step16, data.step17, data.step18, data.step19, data.step20,
    data.user
  ], "HicadData");
}

async function deleteSalaryScale(salcode) {
  return runQuery(
    `DELETE FROM py_salaryscale WHERE salcode = @p0`,
    [salcode],
    "HicadData"
  );
}

module.exports = {
  getOvertimeRates,
  saveOvertimeRate,
  getSalaryGroups, saveSalaryGroup, updateSalaryGroup, deleteSalaryGroup,
  // Element Types
  getElementTypes,
  // Grade Levels
  getGradeLevels,
  // Salary Scale
  getSalaryScales, saveSalaryScale, updateSalaryScale, deleteSalaryScale
};
