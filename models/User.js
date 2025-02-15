const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// קבועים לנעילת חשבון
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME = 30 * 60 * 1000; // 30 דקות

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function (v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  password: {
    type: String,
    required: [true, 'סיסמה היא שדה חובה']
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'deleted'],
    default: 'active'
  },
  lastLogin: {
    type: Date,
    default: null
  },
  notificationPreferences: {
    email: {
      enabled: { type: Boolean, default: true },
      newBooking: { type: Boolean, default: true },
      bookingCancellation: { type: Boolean, default: true },
      reminder: { type: Boolean, default: true }
    },
    push: {
      enabled: { type: Boolean, default: true },
      newBooking: { type: Boolean, default: true },
      bookingCancellation: { type: Boolean, default: true },
      reminder: { type: Boolean, default: true }
    }
  },
  timezone: {
    type: String,
    default: 'Asia/Jerusalem'
  },
  language: {
    type: String,
    default: 'he'
  },
  notificationRead: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  profileImage: {
    type: String,
    default: null
  },
  googleId: {
    type: String,
    sparse: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    code: {
      type: String,
      default: null
    },
    expiresAt: {
      type: Date,
      default: null
    },
    attempts: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// אינדקסים
userSchema.index({ email: 1 }, { unique: true });

// וירטואלים
userSchema.virtual('meetings', {
  ref: 'Meeting',
  localField: '_id',
  foreignField: 'creator'
});

// מתודות
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// הוקים
const fs = require('fs');
const path = require('path');

userSchema.pre('save', async function (next) {
  if (this.isModified('email')) {
    this.email = this.email.toLowerCase();
  }

  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  next();
});

// מתודות עזר לנעילת חשבון
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.incrementLoginAttempts = async function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    // אם נעילת החשבון פגה, אפס את הניסיונות
    await this.updateOne({
      $set: {
        loginAttempts: 1,
        lockUntil: null
      }
    });
    return;
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + LOCK_TIME };
  }

  await this.updateOne(updates);
};

// מתודת השוואת סיסמה משופרת
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    if (this.isLocked) {
      throw new Error('החשבון נעול. אנא נסה שוב מאוחר יותר.');
    }

    const isMatch = await bcrypt.compare(candidatePassword, this.password);

    if (!isMatch) {
      await this.incrementLoginAttempts();
      throw new Error('סיסמה שגויה');
    }

    // אם ההתחברות הצליחה, אפס את מונה הניסיונות
    if (this.loginAttempts > 0) {
      await this.updateOne({
        $set: { loginAttempts: 0, lockUntil: null }
      });
    }

    return true;
  } catch (error) {
    throw error;
  }
};

// Add method to generate OTP
userSchema.methods.generateOTP = function() {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes expiry
    attempts: 0
  };
  
  return otp;
};

// Add method to verify OTP
userSchema.methods.verifyOTP = function(code) {
  if (!this.otp.code || !this.otp.expiresAt) {
    throw new Error('לא נמצא קוד אימות פעיל');
  }

  if (this.otp.expiresAt < Date.now()) {
    throw new Error('קוד האימות פג תוקף');
  }

  if (this.otp.attempts >= 3) {
    throw new Error('חרגת ממספר הניסיונות המותר. אנא בקש קוד חדש');
  }

  this.otp.attempts += 1;

  if (this.otp.code !== code) {
    throw new Error('קוד אימות שגוי');
  }

  return true;
};

module.exports = mongoose.model('User', userSchema);
