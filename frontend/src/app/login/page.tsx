'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import styles from './login.module.css';

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // No password backend — Microsoft SSO is the only real auth path.
  // The email/password form is kept as a visual affordance; submitting
  // it routes through the same SSO flow the button uses.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    window.location.href = 'http://localhost:7777/api/v1/auth/microsoft/login';
  };

  return (
    <div className={styles.wrapper}>

      {/* ── Left Panel ── */}
      <div className={styles.leftPanel}>
        {/* Ambient glow effects */}
        <div className={styles.glowTop} />
        <div className={styles.glowBottom} />
        <div className={styles.gridOverlay} />

        {/* Brand */}
        <Link href="/" className={styles.brand}>
          <div className={styles.logoMark}>GTS</div>
          <div className={styles.brandInfo}>
            <span className={styles.brandName}>Global Trade Sentinel</span>
            <span className={styles.brandBy}>Built on Agno · Retrieval by You.com</span>
          </div>
        </Link>

        {/* Product Manifesto */}
        <div className={styles.testimonial}>
          <div className={styles.testimonialQuote}>
            The rule was public information — it just wasn&apos;t routed to you. That&apos;s the discovery lag Sentinel closes, one primary-source citation at a time.
          </div>
          <div className={styles.stackCredit}>
            <span className={styles.stackChip}>Agno Team · Leader + 6</span>
            <span className={styles.stackChip}>You.com Research API</span>
          </div>
        </div>

        {/* Bottom stats */}
        <div className={styles.statsRow}>
          <div className={styles.statChip}>
            <span className={styles.statChipVal}>6</span>
            <span className={styles.statChipLabel}>Domain Specialists</span>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statChipVal}>100%</span>
            <span className={styles.statChipLabel}>Citation-Backed</span>
          </div>
          <div className={styles.statChip}>
            <span className={styles.statChipVal}>&lt;24h</span>
            <span className={styles.statChipLabel}>Discovery Lag</span>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Login Form ── */}
      <div className={styles.rightPanel}>
        <div className={styles.formContainer}>

          {/* Header */}
          <div className={styles.formHeader}>
            <div className={styles.formLogoMark}>
              <ShieldCheck size={20} />
            </div>
            <h1 className={styles.formTitle}>Welcome back</h1>
            <p className={styles.formSubtitle}>Sign in to your Global Trade Sentinel workspace</p>
          </div>

          {/* Microsoft SSO Button */}
          <button
            className={styles.ssoBtn}
            onClick={() => { window.location.href = 'http://localhost:7777/api/v1/auth/microsoft/login'; }}
          >
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            Continue with Microsoft
          </button>

          {/* Divider */}
          <div className={styles.divider}>
            <span className={styles.dividerLine} />
            <span className={styles.dividerText}>or sign in with email</span>
            <span className={styles.dividerLine} />
          </div>

          {/* Form */}
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Work Email</label>
              <input
                type="email"
                className={styles.input}
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                id="login-email"
                autoComplete="email"
              />
            </div>

            <div className={styles.fieldGroup}>
              <div className={styles.labelRow}>
                <label className={styles.label}>Password</label>
                <a href="#" className={styles.forgotLink}>Forgot password?</a>
              </div>
              <div className={styles.passwordWrapper}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={styles.input}
                  placeholder="••••••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  id="login-password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={`${styles.submitBtn} ${loading ? styles.loading : ''}`}
              disabled={loading}
              id="login-submit"
            >
              {loading ? (
                <span className={styles.spinner} />
              ) : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className={styles.signupNote}>
            Don&apos;t have an account?{' '}
            <a href="mailto:hello@globaltradesentinel.dev" className={styles.signupLink}>
              Request access →
            </a>
          </p>

          <p className={styles.legal}>
            By signing in, you agree to the Global Trade Sentinel{' '}
            <a href="#">Terms of Service</a> and{' '}
            <a href="#">Privacy Policy</a>.
          </p>
        </div>
      </div>

    </div>
  );
}
