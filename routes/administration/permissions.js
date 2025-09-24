// permissions.js - Router for role-based permission system
const express = require('express');
const router = express.Router();

// Import your database pool directly
const pool = require('../../config/db'); // Adjust path as needed

// Database helper functions
class PermissionService {
  
  // Get user with role information
  static async getUserWithRole(pool, userId) {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          u.user_id,
          u.full_name,
          u.email,
          u.user_role,
          u.status,
          u.phone_number,
          u.expiry_date,
          u.primary_class,
          u.created_at
        FROM users u
        WHERE u.user_id = ?
      `, [userId]);
      
      return rows[0] || null;
    } catch (error) {
      throw error;
    }
  }
  
  // Get user permissions based on their role
  static async getUserPermissions(pool, userId) {
    try {
      const [rows] = await pool.execute(`
        SELECT DISTINCT
          p.id,
          p.name,
          p.description
        FROM users u
        JOIN roles r ON u.user_role = r.name
        JOIN role_permissions rp ON r.id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE u.user_id = ?
        ORDER BY p.name
      `, [userId]);
      
      return rows;
    } catch (error) {
      throw error;
    }
  }
  
  // Get all roles
  static async getAllRoles(pool) {
    try {
      const [rows] = await pool.execute(`
        SELECT id, name, description
        FROM roles
        ORDER BY name
      `);
      
      return rows;
    } catch (error) {
      throw error;
    }
  }
  
  // Get all permissions
  static async getAllPermissions(pool) {
    try {
      const [rows] = await pool.execute(`
        SELECT id, name, description
        FROM permissions
        ORDER BY name
      `);
      
      return rows;
    } catch (error) {
      throw error;
    }
  }
}


const verifyToken = require('../../middware/authentication'); 

// Get user permissions 
router.get('/user/permissions', verifyToken, async (req, res) => {
  try {
    // Get userId from your token payload
    const userId = req.user_id;
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'User not authenticated',
        message: 'No user ID found in token' 
      });
    }
    
    // Get user with role
    const user = await PermissionService.getUserWithRole(pool, userId);
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        message: 'User account no longer exists' 
      });
    }
    
    // Get user permissions
    const permissions = await PermissionService.getUserPermissions(pool, userId);
    
    res.json({
      role: {
        name: user.user_role,
        status: user.status
      },
      permissions: permissions,
      user: {
        id: user.user_id,
        name: user.full_name,
        email: user.email,
        role: user.user_role,
        primary_class: user.primary_class
      }
    });
    
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Could not retrieve user permissions' 
    });
  }
});

// Get current user info
router.get('/user/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user_id;
    
    const user = await PermissionService.getUserWithRole(pool, userId);
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        message: 'User account no longer exists' 
      });
    }
    
    res.json({
      user: {
        id: user.user_id,
        name: user.full_name,
        email: user.email,
        role: user.user_role,
        status: user.status,
        phone: user.phone_number,
        primary_class: user.primary_class,
        created_at: user.created_at
      }
    });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Could not retrieve user information' 
    });
  }
});

// Get all roles (admin endpoint)
router.get('/admin/roles', verifyToken, async (req, res) => {
  try {
    const userId = req.user_id;
    
    // Check if user has MANAGE_USERS permission
    const userPermissions = await PermissionService.getUserPermissions(pool, userId);
    const hasManagePermission = userPermissions.some(p => 
      p.name === 'MANAGE_USERS' || p.name === 'FULL_ACCESS'
    );
    
    if (!hasManagePermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to view roles' 
      });
    }
    
    const roles = await PermissionService.getAllRoles(pool);
    res.json({ roles });
    
  } catch (error) {
    console.error('Get roles error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Could not retrieve roles' 
    });
  }
});

// Get all permissions (admin endpoint)
router.get('/admin/permissions', verifyToken, async (req, res) => {
  try {
    const userId = req.user_id;
    
    // Check if user has MANAGE_USERS permission
    const userPermissions = await PermissionService.getUserPermissions(pool, userId);
    const hasManagePermission = userPermissions.some(p => 
      p.name === 'MANAGE_USERS' || p.name === 'FULL_ACCESS'
    );
    
    if (!hasManagePermission) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to view permissions' 
      });
    }
    
    const permissions = await PermissionService.getAllPermissions(pool);
    res.json({ permissions });
    
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Could not retrieve permissions' 
    });
  }
});

module.exports = router;