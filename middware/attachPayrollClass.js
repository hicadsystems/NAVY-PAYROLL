const express = require('express');
const {autoAssignPayrollClass} = require('../routes/helpers/autoassignPayrollClass');
const router = express.Router();

async function attachPayrollClass(req, res, next) {
  try {
    const dbName = req.current_class || req.primary_class;

    if (!dbName) {
      console.log('⚠️ No current_class found in token, skipping auto-assign.');
      return next();
    }

    console.log(`🧩 Auto-assign middleware triggered for DB: ${dbName}`);

    const result = await autoAssignPayrollClass(dbName);

    if (result.updated > 0) {
      console.log(`✅ Auto-assigned ${result.updated} employee(s) in ${dbName}.`);
    } else {
      console.log(`No unassigned employees found or mapping not needed in ${dbName}.`);
    }

    // Optionally attach result for later use
    req.autoAssignResult = result;

    next();
  } catch (error) {
    console.error('❌ Auto-assign middleware error:', error.message);
    // Don't block the request — just log and continue
    next();
  }
}

module.exports = {attachPayrollClass};


