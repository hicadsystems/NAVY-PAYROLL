const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

/**
 * Get all available periods from py_emplhistory for date filtering
 */
exports.getAvailablePeriods = async () => {
  try {
    const [periods] = await pool.query(`
      SELECT DISTINCT period 
      FROM py_emplhistory 
      WHERE period IS NOT NULL AND period != ''
      ORDER BY period DESC
      LIMIT 100
    `);

    return periods.map(p => p.period);
  } catch (err) {
    throw err;
  }
};

/**
 * Get list of all employees for selection dropdown
 */
exports.getEmployeesList = async () => {
  try {
    const [employees] = await pool.query(`
      SELECT 
        Empl_ID,
        CONCAT(Surname, ' ', IFNULL(OtherName, '')) as full_name,
        Location,
        Factory,
        Status
      FROM hr_employees
      WHERE Empl_ID IS NOT NULL AND Empl_ID != ''
      ORDER BY Surname, OtherName
    `);

    return employees;
  } catch (err) {
    throw err;
  }
};

/**
 * Get previous personnel details from py_emplhistory based on period range
 */
exports.getPreviousPersonnelDetails = async (year, month, user, filters = {}) => {
  const logId = await startLog('PersonnelDetailsReport', 'GetPreviousDetails', year, month, user);
  
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 50
    } = filters;

    const offset = (page - 1) * limit;

    // Build WHERE clause
    let whereConditions = [];
    let queryParams = [];

    if (startPeriod && endPeriod) {
      whereConditions.push('period BETWEEN ? AND ?');
      queryParams.push(startPeriod, endPeriod);
    } else if (startPeriod) {
      whereConditions.push('period >= ?');
      queryParams.push(startPeriod);
    } else if (endPeriod) {
      whereConditions.push('period <= ?');
      queryParams.push(endPeriod);
    }

    if (employeeId && employeeId !== 'ALL') {
      whereConditions.push('Empl_ID = ?');
      queryParams.push(employeeId);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM py_emplhistory
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated data with all fields
    const dataQuery = `
      SELECT 
        period,
        Empl_ID,
        Surname,
        OtherName,
        Title,
        TITLEDESC,
        Sex,
        JobClass,
        Jobtitle,
        MaritalStatus,
        Factory,
        Location,
        Birthdate,
        DateEmpl,
        DateLeft,
        TELEPHONE,
        HOMEADDR,
        nok_name,
        Bankcode,
        bankbranch,
        BankACNumber,
        InternalACNo,
        StateofOrigin,
        LocalGovt,
        TaxCode,
        NSITFcode,
        NHFcode,
        seniorno,
        command,
        nok_addr,
        Language1,
        Fluency1,
        Language2,
        Fluency2,
        Language3,
        Fluency3,
        Country,
        Height,
        Weight,
        BloodGroup,
        Genotype,
        entry_mode,
        Status,
        datepmted,
        dateconfirmed,
        taxed,
        gradelevel,
        gradetype,
        entitlement,
        town,
        createdby,
        datecreated,
        nok_relation,
        specialisation,
        accomm_type,
        qual_allow,
        sp_qual_allow,
        rent_subsidy,
        instruction_allow,
        command_allow,
        award,
        payrollclass,
        email,
        pfacode,
        state,
        emolumentform,
        dateadded,
        exittype,
        CONCAT(Surname, ' ', IFNULL(OtherName, '')) as full_name
      FROM py_emplhistory
      ${whereClause}
      ORDER BY period DESC, Surname, OtherName
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [...queryParams, limit, offset]);

    await updateLog(logId, 'SUCCESS', `Retrieved ${rows.length} of ${totalRecords} previous personnel records.`);

    return {
      records: rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

/**
 * Get current personnel details from hr_employees
 */
exports.getCurrentPersonnelDetailsFiltered = async (year, month, user, filters = {}) => {
  const { employeeIds, page = 1, limit = 5 } = filters;
  const offset = (page - 1) * limit;

  // Build WHERE clause for employee IDs using MySQL placeholders
  const placeholders = employeeIds.map(() => '?').join(',');
  
  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM hr_employees 
    WHERE Empl_ID IN (${placeholders})
  `;
  const [countResult] = await pool.query(countQuery, employeeIds);
  const totalRecords = parseInt(countResult[0].total);
  const totalPages = Math.ceil(totalRecords / limit);

  // Get paginated records
  const dataQuery = `
    SELECT * 
    FROM hr_employees 
    WHERE Empl_ID IN (${placeholders})
    ORDER BY Empl_ID
    LIMIT ? OFFSET ?
  `;
  const params = [...employeeIds, limit, offset];
  const [dataResult] = await pool.query(dataQuery, params);

  return {
    records: dataResult,
    pagination: {
      page,
      limit,
      totalPages,
      totalRecords
    }
  };
};

/**
 * GET: Current personnel details - filtered by employees in previous report
 */
exports.getCurrentPersonnelDetails = async (req, res) => {
  try {
    const { 
      startPeriod,
      endPeriod,
      employeeId,
      page = 1,
      limit = 5
    } = req.query;

    // Validate required filters
    if (!startPeriod || !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Start and end periods are required to match with previous report'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    // First, get the list of employee IDs from previous report
    // FIXED: Changed from PostgreSQL ($1, $2) to MySQL (?) placeholders
    let prevEmployeeIdsQuery = `
      SELECT DISTINCT Empl_ID 
      FROM py_emplhistory 
      WHERE period >= ? AND period <= ?
    `;
    const prevParams = [startPeriod, endPeriod];
    
    if (employeeId) {
      prevEmployeeIdsQuery += ` AND Empl_ID = ?`;
      prevParams.push(employeeId);
    }

    const [prevEmployeeIds] = await pool.query(prevEmployeeIdsQuery, prevParams);
    
    if (prevEmployeeIds.length === 0) {
      return res.json({
        status: 'SUCCESS',
        reportType: 'CURRENT_DETAILS',
        filters: { startPeriod, endPeriod, employeeId },
        retrievedAt: new Date().toISOString(),
        records: [],
        pagination: { page: 1, limit, totalPages: 0, totalRecords: 0 }
      });
    }

    const emplIds = prevEmployeeIds.map(row => row.Empl_ID);

    // Now get current data only for those employee IDs
    const result = await personnelDetailsService.getCurrentPersonnelDetailsFiltered(
      year, 
      month, 
      user, 
      {
        employeeIds: emplIds,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'CURRENT_DETAILS',
      filters: { startPeriod, endPeriod, employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting current personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * Get personnel analysis with categorization
 */
exports.getPersonnelAnalysis = async (year, month, filters = {}) => {
  const { startPeriod, endPeriod, filter = 'all', page = 1, limit = 5, searchQuery } = filters;
  const offset = (page - 1) * limit;

  // CRITICAL: Determine the most recent completed payroll cycle
  // This is dynamic per company - some may be at 202506, others at 202510, etc.
  const mostRecentCycle = await getMostRecentCompletedCycle();

  // Step 1: Get all employees from SELECTED period range (for analysis comparison)
  const prevQuery = `
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory 
    WHERE period >= ? AND period <= ?
  `;
  const [prevEmployees] = await pool.query(prevQuery, [startPeriod, endPeriod]);
  const prevEmployeeIds = new Set(prevEmployees.map(e => e.Empl_ID));

  // Step 1B: Get all employees from MOST RECENT completed payroll cycle
  // CRITICAL: This determines who is truly "new" vs "existing" for payroll computation
  const recentCycleQuery = `
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory 
    WHERE period = ?
  `;
  const [recentCycleEmployees] = await pool.query(recentCycleQuery, [mostRecentCycle]);
  const recentCycleIds = new Set(recentCycleEmployees.map(e => e.Empl_ID));

  // Step 2: Get employees who existed in the previous period OR currently exist
  // This matches the logic in getPreviousPersonnelDetails
  const currQuery = `
    SELECT DISTINCT e.Empl_ID
    FROM hr_employees e
    WHERE e.Empl_ID IN (
      SELECT DISTINCT Empl_ID 
      FROM py_emplhistory 
      WHERE period >= ? AND period <= ?
    )
    OR e.Empl_ID IN (SELECT Empl_ID FROM hr_employees)
  `;
  const [currEmployees] = await pool.query(currQuery, [startPeriod, endPeriod]);
  
  // Filter to only include those who existed in the period or currently exist
  const employeesInPeriodQuery = `
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory 
    WHERE period >= ? AND period <= ?
    UNION
    SELECT Empl_ID FROM hr_employees
  `;
  const [allRelevantEmployees] = await pool.query(employeesInPeriodQuery, [startPeriod, endPeriod]);
  const currEmployeeIds = new Set(allRelevantEmployees.map(e => e.Empl_ID));

  // Step 3: Get old employees (those with DateLeft or exittype) - Do this BEFORE categorizing
  const oldQuery = `
    SELECT Empl_ID 
    FROM hr_employees 
    WHERE (DateLeft IS NOT NULL AND DateLeft != '' AND TRIM(DateLeft) != '') 
       OR (exittype IS NOT NULL AND exittype != '' AND TRIM(exittype) != '')
  `;
  const [oldEmployeesList] = await pool.query(oldQuery);
  const oldEmployees = oldEmployeesList.map(e => e.Empl_ID);
  const oldEmployeeIds = new Set(oldEmployees);

  // Step 4: Categorize employees based on MOST RECENT CYCLE
  // CRITICAL FOR PAYROLL: New vs Existing determines computation method
  // NEW = Not in most recent completed cycle (202510) AND not old
  // EXISTING = In most recent completed cycle (202510) AND not old
  const newEmployees = [...currEmployeeIds].filter(id => 
    !recentCycleIds.has(id) && !oldEmployeeIds.has(id)
  );
  const existingEmployees = [...currEmployeeIds].filter(id => 
    recentCycleIds.has(id) && !oldEmployeeIds.has(id)
  );

  // Step 5: Build search clause (WITHOUT alias for count queries)
  let searchClause = '';
  let searchClauseWithAlias = '';
  let searchParams = [];
  
  if (searchQuery) {
    searchClause = ` AND (
      Empl_ID LIKE ? OR 
      Surname LIKE ? OR 
      OtherName LIKE ? OR
      CONCAT(Surname, ' ', OtherName) LIKE ?
    )`;
    searchClauseWithAlias = ` AND (
      curr.Empl_ID LIKE ? OR 
      curr.Surname LIKE ? OR 
      curr.OtherName LIKE ? OR
      CONCAT(curr.Surname, ' ', curr.OtherName) LIKE ?
    )`;
    const searchPattern = `%${searchQuery}%`;
    searchParams = [searchPattern, searchPattern, searchPattern, searchPattern];
  }

  // Step 6: Build the main query based on filter
  let mainQuery = '';
  let queryParams = [];
  let countQuery = '';
  let countParams = [];

  if (filter === 'new') {
    // New employees only (not in most recent cycle)
    if (newEmployees.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    const placeholders = newEmployees.map(() => '?').join(',');
    mainQuery = `
      SELECT 
        curr.*,
        'new' as category,
        0 as changesCount
      FROM hr_employees curr
      WHERE curr.Empl_ID IN (${placeholders})
      ${searchClauseWithAlias}
      ORDER BY curr.Empl_ID
      LIMIT ? OFFSET ?
    `;
    queryParams = [...newEmployees, ...searchParams, limit, offset];
    
    countQuery = `SELECT COUNT(*) as total FROM hr_employees WHERE Empl_ID IN (${placeholders}) ${searchClause}`;
    countParams = [...newEmployees, ...searchParams];
    
  } else if (filter === 'old') {
    // Old employees only
    if (oldEmployees.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    const placeholders = oldEmployees.map(() => '?').join(',');
    mainQuery = `
      SELECT 
        curr.*,
        'old' as category,
        0 as changesCount
      FROM hr_employees curr
      WHERE curr.Empl_ID IN (${placeholders})
      ${searchClauseWithAlias}
      ORDER BY curr.Empl_ID
      LIMIT ? OFFSET ?
    `;
    queryParams = [...oldEmployees, ...searchParams, limit, offset];
    
    countQuery = `SELECT COUNT(*) as total FROM hr_employees WHERE Empl_ID IN (${placeholders}) ${searchClause}`;
    countParams = [...oldEmployees, ...searchParams];
    
  } else if (filter === 'changes') {
    // Employees with changes only (must be existing employees)
    if (existingEmployees.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    // Get detailed comparison data to count changes
    const analysisData = await getDetailedAnalysis(existingEmployees, startPeriod, endPeriod);
    let employeesWithChanges = analysisData.filter(emp => emp.changesCount > 0);
    
    // Apply search filter if present
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      employeesWithChanges = employeesWithChanges.filter(emp => {
        const fullName = `${emp.Surname || ''} ${emp.OtherName || ''}`.toLowerCase();
        return (emp.Empl_ID || '').toLowerCase().includes(lowerQuery) ||
               (emp.Surname || '').toLowerCase().includes(lowerQuery) ||
               (emp.OtherName || '').toLowerCase().includes(lowerQuery) ||
               fullName.includes(lowerQuery);
      });
    }
    
    if (employeesWithChanges.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    // Paginate the filtered results
    const paginatedData = employeesWithChanges.slice(offset, offset + limit);
    const totalRecords = employeesWithChanges.length;
    const totalPages = Math.ceil(totalRecords / limit);
    
    return {
      records: paginatedData,
      stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees),
      pagination: { page, limit, totalPages, totalRecords }
    };
    
  } else {
    // All employees
    let whereClause = searchQuery ? `WHERE 1=1 ${searchClauseWithAlias}` : '';
    let whereClauseNoAlias = searchQuery ? `WHERE 1=1 ${searchClause}` : '';
    
    mainQuery = `
      SELECT 
        curr.*,
        CASE 
          WHEN (curr.DateLeft IS NOT NULL AND curr.DateLeft != '') 
            OR (curr.exittype IS NOT NULL AND curr.exittype != '') THEN 'old'
          ELSE 'existing'
        END as category,
        0 as changesCount
      FROM hr_employees curr
      ${whereClause}
      ORDER BY curr.Empl_ID
      LIMIT ? OFFSET ?
    `;
    queryParams = [...searchParams, limit, offset];
    
    countQuery = `SELECT COUNT(*) as total FROM hr_employees ${whereClauseNoAlias}`;
    countParams = searchParams;
  }

  // Execute queries for non-changes filters
  if (filter !== 'changes') {
    const [countResult] = await pool.query(countQuery, countParams);
    const totalRecords = parseInt(countResult[0].total);
    const totalPages = Math.ceil(totalRecords / limit);

    const [records] = await pool.query(mainQuery, queryParams);

    // For 'all' filter, categorize based on MOST RECENT CYCLE (not filtered period)
    if (filter === 'all') {
      for (let record of records) {
        // Check if employee has left first (priority check)
        const hasLeft = oldEmployees.includes(record.Empl_ID) || 
                       (record.DateLeft && String(record.DateLeft).trim() !== '') || 
                       (record.exittype && String(record.exittype).trim() !== '');
        
        if (hasLeft) {
          record.category = 'old';
          record.changesCount = 0;
        } else if (newEmployees.includes(record.Empl_ID)) {
          // NEW = Not in most recent cycle (202510)
          record.category = 'new';
          record.changesCount = 0;
        } else if (existingEmployees.includes(record.Empl_ID)) {
          // EXISTING = In most recent cycle (202510)
          // Check for changes within the FILTERED period
          record.changesCount = await getChangesCount(record.Empl_ID, startPeriod, endPeriod);
          record.category = record.changesCount > 0 ? 'changed' : 'existing';
        }
      }
    } else {
      // For specific filters, maintain correct categorization
      if (filter === 'new') {
        for (let record of records) {
          // Double-check: ensure they haven't left
          const hasLeft = oldEmployees.includes(record.Empl_ID) || 
                         (record.DateLeft && String(record.DateLeft).trim() !== '') || 
                         (record.exittype && String(record.exittype).trim() !== '');
          if (hasLeft) {
            record.category = 'old';
          } else {
            record.category = 'new';
          }
        }
      } else if (filter === 'old') {
        // Ensure all old records have correct category
        for (let record of records) {
          record.category = 'old';
          record.changesCount = 0;
        }
      }
    }

    return {
      records,
      stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees),
      pagination: { page, limit, totalPages, totalRecords }
    };
  }
};

// Helper function to dynamically get the most recent completed cycle
// CRITICAL: Different companies may be at different cycles (202506, 202510, etc.)
// This ensures we use their actual latest cycle, not an assumed one
async function getMostRecentCompletedCycle() {
  try {
    const query = `
      SELECT MAX(period) as mostRecent 
      FROM py_emplhistory
      WHERE period IS NOT NULL
    `;
    const [result] = await pool.query(query);
    
    if (!result[0]?.mostRecent) {
      // If no payroll history exists, use current period as fallback
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      return parseInt(`${year}${month}`);
    }
    
    return parseInt(result[0].mostRecent);
  } catch (error) {
    console.error('Error getting most recent cycle:', error);
    // Fallback to current period
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return parseInt(`${year}${month}`);
  }
}

/**
 * Helper: Get analysis statistics
 */
async function getAnalysisStats(newEmployees, existingEmployees, oldEmployees) {
  const [totalResult] = await pool.query('SELECT COUNT(*) as total FROM hr_employees');
  const total = parseInt(totalResult[0].total);
  
  // Get accurate count of employees with changes
  // This will compare all existing employees (not new, not old) with their previous records
  let changesCount = 0;
  
  // Filter out old employees from existing employees for accurate count
  const activeExistingEmployees = existingEmployees.filter(id => !oldEmployees.includes(id));
  
  // For performance, we'll do a batch comparison
  if (activeExistingEmployees.length > 0) {
    // This is a simplified approach - for production you might want to cache this
    // Get a sample or do full comparison based on your needs
    changesCount = activeExistingEmployees.length; // Placeholder - ideally calculate actual changes
  }
  
  // Filter newEmployees to exclude those who have actually left (have DateLeft or exittype)
  const placeholdersNew = newEmployees.map(() => '?').join(',');
  let actualNewCount = newEmployees.length;
  
  if (newEmployees.length > 0) {
    const newLeftQuery = `
      SELECT COUNT(*) as leftCount 
      FROM hr_employees 
      WHERE Empl_ID IN (${placeholdersNew})
        AND ((DateLeft IS NOT NULL AND DateLeft != '') 
             OR (exittype IS NOT NULL AND exittype != ''))
    `;
    const [newLeftResult] = await pool.query(newLeftQuery, newEmployees);
    const newLeftCount = parseInt(newLeftResult[0].leftCount);
    
    // Subtract those who have left from new count
    actualNewCount = newEmployees.length - newLeftCount;
  }

  return {
    total,
    new: actualNewCount,
    changes: changesCount,
    old: oldEmployees.length
  };
}

/**
 * Helper: Get detailed analysis with change counts for existing employees
 */
async function getDetailedAnalysis(employeeIds, startPeriod, endPeriod) {
  if (employeeIds.length === 0) return [];

  const placeholders = employeeIds.map(() => '?').join(',');
  
  // Get current data
  const currQuery = `SELECT * FROM hr_employees WHERE Empl_ID IN (${placeholders})`;
  const [currRecords] = await pool.query(currQuery, employeeIds);
  
  // Get previous data
  const prevQuery = `
    SELECT * FROM py_emplhistory 
    WHERE Empl_ID IN (${placeholders}) 
      AND period >= ? AND period <= ?
    ORDER BY period DESC
  `;
  const [prevRecords] = await pool.query(prevQuery, [...employeeIds, startPeriod, endPeriod]);
  
  // Create maps for quick lookup
  const currMap = {};
  currRecords.forEach(rec => {
    currMap[rec.Empl_ID] = rec;
  });
  
  const prevMap = {};
  prevRecords.forEach(rec => {
    if (!prevMap[rec.Empl_ID]) {
      prevMap[rec.Empl_ID] = rec; // Take most recent
    }
  });
  
  // Compare and build analysis data
  const results = [];
  
  for (const emplId of employeeIds) {
    const curr = currMap[emplId];
    const prev = prevMap[emplId];
    
    if (!curr || !prev) continue;
    
    const changesCount = countFieldChanges(prev, curr);
    
    results.push({
      ...curr,
      category: changesCount > 0 ? 'changed' : 'existing',
      changesCount
    });
  }
  
  return results;
}

/**
 * Helper: Count changes between previous and current record
 */
async function getChangesCount(emplId, startPeriod, endPeriod) {
  // Get most recent previous record
  const prevQuery = `
    SELECT * FROM py_emplhistory 
    WHERE Empl_ID = ? AND period >= ? AND period <= ?
    ORDER BY period DESC LIMIT 1
  `;
  const [prevRecords] = await pool.query(prevQuery, [emplId, startPeriod, endPeriod]);
  
  if (prevRecords.length === 0) return 0;
  
  // Get current record
  const currQuery = `SELECT * FROM hr_employees WHERE Empl_ID = ?`;
  const [currRecords] = await pool.query(currQuery, [emplId]);
  
  if (currRecords.length === 0) return 0;
  
  return countFieldChanges(prevRecords[0], currRecords[0]);
}

/**
 * Helper: Count field differences between two records
 */
function countFieldChanges(prevRecord, currRecord) {
  const fieldsToCompare = [
    'Surname', 'OtherName', 'Title', 'Sex', 'Jobtitle', 'MaritalStatus',
    'Factory', 'Location', 'Birthdate', 'DateEmpl', 'TELEPHONE', 'HOMEADDR',
    'nok_name', 'Bankcode', 'bankbranch', 'BankACNumber', 'StateofOrigin',
    'LocalGovt', 'Status', 'gradelevel', 'email', 'pfacode'
  ];
  
  let changesCount = 0;
  
  for (const field of fieldsToCompare) {
    const prevVal = String(prevRecord[field] || '').trim();
    const currVal = String(currRecord[field] || '').trim();
    
    // Special handling for name concatenation
    if (field === 'Surname') {
      const prevFullName = `${prevRecord.Surname || ''} ${prevRecord.OtherName || ''}`.trim();
      const currFullName = `${currRecord.Surname || ''} ${currRecord.OtherName || ''}`.trim();
      
      if (prevFullName !== currFullName) {
        changesCount++;
      }
      continue;
    }
    
    // Skip OtherName as it's already counted with Surname
    if (field === 'OtherName') continue;
    
    if (prevVal !== currVal) {
      changesCount++;
    }
  }
  
  return changesCount;
}

/**
 * Export analysis to Excel
 */
exports.exportAnalysisExcel = async (filters = {}) => {
  const { startPeriod, endPeriod, filter = 'all' } = filters;
  
  // Get all records without pagination
  const result = await exports.getPersonnelAnalysis(0, 0, {
    startPeriod,
    endPeriod,
    filter,
    page: 1,
    limit: 999999 // Get all records
  });
  
  return result.records;
};

/**
 * Check which employees from a list exist in previous period
 */
exports.checkEmployeesInPrevious = async (employeeIds, startPeriod, endPeriod) => {
  if (!employeeIds || employeeIds.length === 0) {
    return [];
  }
  
  const placeholders = employeeIds.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory 
    WHERE Empl_ID IN (${placeholders}) 
      AND period >= ? 
      AND period <= ?
  `;
  
  const [results] = await pool.query(query, [...employeeIds, startPeriod, endPeriod]);
  return results.map(r => r.Empl_ID);
};

/**
 * Get comparison between previous and current personnel details
 */
exports.getPersonnelDetailsComparison = async (year, month, user, filters = {}) => {
  const logId = await startLog('PersonnelDetailsReport', 'GetComparison', year, month, user);
  
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 20
    } = filters;

    const offset = (page - 1) * limit;

    // Build WHERE clause for previous data
    let prevWhereConditions = [];
    let prevQueryParams = [];

    if (startPeriod && endPeriod) {
      prevWhereConditions.push('hist.period BETWEEN ? AND ?');
      prevQueryParams.push(startPeriod, endPeriod);
    } else if (startPeriod) {
      prevWhereConditions.push('hist.period >= ?');
      prevQueryParams.push(startPeriod);
    } else if (endPeriod) {
      prevWhereConditions.push('hist.period <= ?');
      prevQueryParams.push(endPeriod);
    }

    if (employeeId && employeeId !== 'ALL') {
      prevWhereConditions.push('cur.Empl_ID = ?');
      prevQueryParams.push(employeeId);
    }

    const prevWhereClause = prevWhereConditions.length > 0 
      ? 'AND ' + prevWhereConditions.join(' AND ') 
      : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT cur.Empl_ID) as total
      FROM hr_employees cur
      LEFT JOIN (
        SELECT h1.*
        FROM py_emplhistory h1
        INNER JOIN (
          SELECT Empl_ID, MAX(period) as max_period
          FROM py_emplhistory
          ${prevWhereConditions.length > 0 ? 'WHERE ' + prevWhereConditions.join(' AND ').replace('cur.Empl_ID', 'Empl_ID').replace('hist.period', 'period') : ''}
          GROUP BY Empl_ID
        ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
      ) hist ON cur.Empl_ID = hist.Empl_ID
      WHERE 1=1 ${prevWhereClause.replace('hist.period', 'hist.period').replace('cur.Empl_ID', 'cur.Empl_ID')}
    `;
    
    const [countResult] = await pool.query(countQuery, prevQueryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // Get comparison data
    const dataQuery = `
      SELECT 
        cur.Empl_ID,
        CONCAT(cur.Surname, ' ', IFNULL(cur.OtherName, '')) as full_name,
        cur.Location,
        cur.Factory,
        
        -- Current values as JSON
        JSON_OBJECT(
          'Surname', cur.Surname,
          'OtherName', cur.OtherName,
          'Title', cur.Title,
          'TITLEDESC', cur.TITLEDESC,
          'Sex', cur.Sex,
          'JobClass', cur.JobClass,
          'Jobtitle', cur.Jobtitle,
          'MaritalStatus', cur.MaritalStatus,
          'Factory', cur.Factory,
          'Location', cur.Location,
          'Birthdate', cur.Birthdate,
          'DateEmpl', cur.DateEmpl,
          'DateLeft', cur.DateLeft,
          'TELEPHONE', cur.TELEPHONE,
          'HOMEADDR', cur.HOMEADDR,
          'nok_name', cur.nok_name,
          'Bankcode', cur.Bankcode,
          'bankbranch', cur.bankbranch,
          'BankACNumber', cur.BankACNumber,
          'InternalACNo', cur.InternalACNo,
          'StateofOrigin', cur.StateofOrigin,
          'LocalGovt', cur.LocalGovt,
          'TaxCode', cur.TaxCode,
          'NSITFcode', cur.NSITFcode,
          'NHFcode', cur.NHFcode,
          'seniorno', cur.seniorno,
          'command', cur.command,
          'nok_addr', cur.nok_addr,
          'Language1', cur.Language1,
          'Fluency1', cur.Fluency1,
          'Language2', cur.Language2,
          'Fluency2', cur.Fluency2,
          'Language3', cur.Language3,
          'Fluency3', cur.Fluency3,
          'Country', cur.Country,
          'Height', cur.Height,
          'Weight', cur.Weight,
          'BloodGroup', cur.BloodGroup,
          'Genotype', cur.Genotype,
          'entry_mode', cur.entry_mode,
          'Status', cur.Status,
          'datepmted', cur.datepmted,
          'dateconfirmed', cur.dateconfirmed,
          'taxed', cur.taxed,
          'gradelevel', cur.gradelevel,
          'gradetype', cur.gradetype,
          'entitlement', cur.entitlement,
          'town', cur.town,
          'createdby', cur.createdby,
          'datecreated', cur.datecreated,
          'nok_relation', cur.nok_relation,
          'specialisation', cur.specialisation,
          'accomm_type', cur.accomm_type,
          'qual_allow', cur.qual_allow,
          'sp_qual_allow', cur.sp_qual_allow,
          'rent_subsidy', cur.rent_subsidy,
          'instruction_allow', cur.instruction_allow,
          'command_allow', cur.command_allow,
          'award', cur.award,
          'payrollclass', cur.payrollclass,
          'email', cur.email,
          'pfacode', cur.pfacode,
          'state', cur.state,
          'emolumentform', cur.emolumentform,
          'dateadded', cur.dateadded,
          'exittype', cur.exittype,
          'gsm_number', cur.gsm_number,
          'nokphone', cur.nokphone,
          'religion', cur.religion
        ) as current_values,
        
        -- Previous values as JSON
        JSON_OBJECT(
          'period', IFNULL(hist.period, ''),
          'Surname', IFNULL(hist.Surname, ''),
          'OtherName', IFNULL(hist.OtherName, ''),
          'Title', IFNULL(hist.Title, ''),
          'TITLEDESC', IFNULL(hist.TITLEDESC, ''),
          'Sex', IFNULL(hist.Sex, ''),
          'JobClass', IFNULL(hist.JobClass, ''),
          'Jobtitle', IFNULL(hist.Jobtitle, ''),
          'MaritalStatus', IFNULL(hist.MaritalStatus, ''),
          'Factory', IFNULL(hist.Factory, ''),
          'Location', IFNULL(hist.Location, ''),
          'Birthdate', IFNULL(hist.Birthdate, ''),
          'DateEmpl', IFNULL(hist.DateEmpl, ''),
          'DateLeft', IFNULL(hist.DateLeft, ''),
          'TELEPHONE', IFNULL(hist.TELEPHONE, ''),
          'HOMEADDR', IFNULL(hist.HOMEADDR, ''),
          'nok_name', IFNULL(hist.nok_name, ''),
          'Bankcode', IFNULL(hist.Bankcode, ''),
          'bankbranch', IFNULL(hist.bankbranch, ''),
          'BankACNumber', IFNULL(hist.BankACNumber, ''),
          'InternalACNo', IFNULL(hist.InternalACNo, ''),
          'StateofOrigin', IFNULL(hist.StateofOrigin, ''),
          'LocalGovt', IFNULL(hist.LocalGovt, ''),
          'TaxCode', IFNULL(hist.TaxCode, ''),
          'NSITFcode', IFNULL(hist.NSITFcode, ''),
          'NHFcode', IFNULL(hist.NHFcode, ''),
          'seniorno', IFNULL(hist.seniorno, ''),
          'command', IFNULL(hist.command, ''),
          'nok_addr', IFNULL(hist.nok_addr, ''),
          'Language1', IFNULL(hist.Language1, ''),
          'Fluency1', IFNULL(hist.Fluency1, ''),
          'Language2', IFNULL(hist.Language2, ''),
          'Fluency2', IFNULL(hist.Fluency2, ''),
          'Language3', IFNULL(hist.Language3, ''),
          'Fluency3', IFNULL(hist.Fluency3, ''),
          'Country', IFNULL(hist.Country, ''),
          'Height', IFNULL(hist.Height, ''),
          'Weight', IFNULL(hist.Weight, ''),
          'BloodGroup', IFNULL(hist.BloodGroup, ''),
          'Genotype', IFNULL(hist.Genotype, ''),
          'entry_mode', IFNULL(hist.entry_mode, ''),
          'Status', IFNULL(hist.Status, ''),
          'datepmted', IFNULL(hist.datepmted, ''),
          'dateconfirmed', IFNULL(hist.dateconfirmed, ''),
          'taxed', IFNULL(hist.taxed, ''),
          'gradelevel', IFNULL(hist.gradelevel, ''),
          'gradetype', IFNULL(hist.gradetype, ''),
          'entitlement', IFNULL(hist.entitlement, ''),
          'town', IFNULL(hist.town, ''),
          'createdby', IFNULL(hist.createdby, ''),
          'datecreated', IFNULL(hist.datecreated, ''),
          'nok_relation', IFNULL(hist.nok_relation, ''),
          'specialisation', IFNULL(hist.specialisation, ''),
          'accomm_type', IFNULL(hist.accomm_type, ''),
          'qual_allow', IFNULL(hist.qual_allow, ''),
          'sp_qual_allow', IFNULL(hist.sp_qual_allow, ''),
          'rent_subsidy', IFNULL(hist.rent_subsidy, ''),
          'instruction_allow', IFNULL(hist.instruction_allow, ''),
          'command_allow', IFNULL(hist.command_allow, ''),
          'award', IFNULL(hist.award, ''),
          'payrollclass', IFNULL(hist.payrollclass, ''),
          'email', IFNULL(hist.email, ''),
          'pfacode', IFNULL(hist.pfacode, ''),
          'state', IFNULL(hist.state, ''),
          'emolumentform', IFNULL(hist.emolumentform, ''),
          'dateadded', IFNULL(hist.dateadded, ''),
          'exittype', IFNULL(hist.exittype, '')
        ) as previous_values,
        
        -- Has changes indicator
        CASE 
          WHEN hist.Empl_ID IS NULL THEN 1
          ELSE 0
        END as is_new_employee
        
      FROM hr_employees cur
      LEFT JOIN (
        SELECT h1.*
        FROM py_emplhistory h1
        INNER JOIN (
          SELECT Empl_ID, MAX(period) as max_period
          FROM py_emplhistory
          ${prevWhereConditions.length > 0 ? 'WHERE ' + prevWhereConditions.join(' AND ').replace('cur.Empl_ID', 'Empl_ID').replace('hist.period', 'period') : ''}
          GROUP BY Empl_ID
        ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
      ) hist ON cur.Empl_ID = hist.Empl_ID
      
      WHERE 1=1 ${prevWhereClause}
      ORDER BY cur.Surname, cur.OtherName
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [...prevQueryParams, limit, offset]);

    // Parse JSON fields
    const records = rows.map(row => ({
      ...row,
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Retrieved ${records.length} of ${totalRecords} comparison records.`);

    return {
      records,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

exports.searchPreviousPersonnelDetails = async (year, month, user, filters = {}) => {
  const { startPeriod, endPeriod, employeeId, searchQuery, page = 1, limit = 5 } = filters;
  const offset = (page - 1) * limit;

  let whereClause = 'WHERE period >= ? AND period <= ?';
  const params = [startPeriod, endPeriod];

  if (employeeId) {
    whereClause += ' AND Empl_ID = ?';
    params.push(employeeId);
  }

  // Add search conditions
  const searchLower = `%${searchQuery.toLowerCase()}%`;
  whereClause += ` AND (
    LOWER(Empl_ID) LIKE ? OR
    LOWER(Surname) LIKE ? OR
    LOWER(OtherName) LIKE ? OR
    LOWER(CONCAT(Surname, ' ', OtherName)) LIKE ? OR
    LOWER(Location) LIKE ? OR
    LOWER(gradelevel) LIKE ?
  )`;
  params.push(searchLower, searchLower, searchLower, searchLower, searchLower, searchLower);

  // Get total count
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM py_emplhistory
    ${whereClause}
  `;
  const [countResult] = await pool.query(countQuery, params);
  const totalRecords = parseInt(countResult[0].total);
  const totalPages = Math.ceil(totalRecords / limit);

  // Get paginated records
  const dataQuery = `
    SELECT *
    FROM py_emplhistory
    ${whereClause}
    ORDER BY period DESC, Empl_ID
    LIMIT ? OFFSET ?
  `;

  const finalParams = [...params, limit, offset];
  const [dataResult] = await pool.query(dataQuery, finalParams);

  return {
    records: dataResult,
    pagination: {
      page,
      limit,
      totalPages,
      totalRecords
    }
  };
};

exports.searchCurrentPersonnelDetails = async (year, month, user, filters = {}) => {
  const { startPeriod, endPeriod, employeeId, searchQuery, page = 1, limit = 5 } = filters;
  const offset = (page - 1) * limit;

  // Get employee IDs from previous history
  let prevQuery = `
    SELECT DISTINCT Empl_ID
    FROM py_emplhistory
    WHERE period >= ? AND period <= ?
  `;
  const prevParams = [startPeriod, endPeriod];

  if (employeeId) {
    prevQuery += ' AND Empl_ID = ?';
    prevParams.push(employeeId);
  }

  const [prevEmployeeIds] = await pool.query(prevQuery, prevParams);

  if (prevEmployeeIds.length === 0) {
    return {
      records: [],
      pagination: { page: 1, limit, totalPages: 0, totalRecords: 0 }
    };
  }

  // Extract IDs into array
  const emplIds = prevEmployeeIds.map(row => row.Empl_ID);

  // Build IN clause
  const inPlaceholders = emplIds.map(() => '?').join(',');

  const searchLower = `%${searchQuery.toLowerCase()}%`;

  const params = [...emplIds, searchLower, searchLower, searchLower, searchLower, searchLower, searchLower];

  const whereClause = `
    WHERE Empl_ID IN (${inPlaceholders})
    AND (
      LOWER(Empl_ID) LIKE ? OR
      LOWER(Surname) LIKE ? OR
      LOWER(OtherName) LIKE ? OR
      LOWER(CONCAT(Surname, ' ', OtherName)) LIKE ? OR
      LOWER(Location) LIKE ? OR
      LOWER(gradelevel) LIKE ?
    )
  `;

  // Count query
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM hr_employees
    ${whereClause}
  `;
  const [countResult] = await pool.query(countQuery, params);
  const totalRecords = parseInt(countResult[0].total);
  const totalPages = Math.ceil(totalRecords / limit);

  // Data query
  const dataQuery = `
    SELECT *
    FROM hr_employees
    ${whereClause}
    ORDER BY Empl_ID
    LIMIT ? OFFSET ?
  `;
  const dataParams = [...params, limit, offset];
  const [dataResult] = await pool.query(dataQuery, dataParams);

  return {
    records: dataResult,
    pagination: {
      page,
      limit,
      totalPages,
      totalRecords
    }
  };
};

/**
 * Get all previous personnel details for export (no pagination)
 */
exports.getAllPreviousDetailsForExport = async (filters = {}) => {
  try {
    const { startPeriod, endPeriod, employeeId } = filters;

    let whereConditions = [];
    let queryParams = [];

    if (startPeriod && endPeriod) {
      whereConditions.push('period BETWEEN ? AND ?');
      queryParams.push(startPeriod, endPeriod);
    } else if (startPeriod) {
      whereConditions.push('period >= ?');
      queryParams.push(startPeriod);
    } else if (endPeriod) {
      whereConditions.push('period <= ?');
      queryParams.push(endPeriod);
    }

    if (employeeId && employeeId !== 'ALL') {
      whereConditions.push('Empl_ID = ?');
      queryParams.push(employeeId);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    const query = `SELECT * FROM py_emplhistory ${whereClause} ORDER BY period DESC, Surname, OtherName`;
    const [rows] = await pool.query(query, queryParams);

    return rows;
  } catch (err) {
    throw err;
  }
};

/**
 * Get all current personnel details for export (no pagination)
 */
exports.getAllCurrentDetailsForExport = async (filters = {}) => {
  try {
    const { employeeId } = filters;

    let whereConditions = [];
    let queryParams = [];

    if (employeeId && employeeId !== 'ALL') {
      whereConditions.push('Empl_ID = ?');
      queryParams.push(employeeId);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    const query = `SELECT * FROM hr_employees ${whereClause} ORDER BY Surname, OtherName`;
    const [rows] = await pool.query(query, queryParams);

    return rows;
  } catch (err) {
    throw err;
  }
};