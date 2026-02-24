import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
import Layout from './components/Layout';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Broadcast from './pages/Broadcast';
import Settings from './pages/Settings';
import Landing from './pages/Landing';
import SignInPage from './pages/SignIn';
import SignUpPage from './pages/SignUp';
import SsoCallback from './pages/SsoCallback';
import './index.css';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Landing />} />

                {/* Clerk Auth Routes */}
                <Route
                    path="/sign-in/*"
                    element={<SignInPage />}
                />
                <Route
                    path="/sign-up/*"
                    element={<SignUpPage />}
                />
                <Route path="/sso-callback" element={<SsoCallback />} />

                {/* Protected Routes */}
                <Route
                    path="/app"
                    element={
                        <>
                            <SignedIn>
                                <Layout />
                            </SignedIn>
                            <SignedOut>
                                <RedirectToSignIn />
                            </SignedOut>
                        </>
                    }
                >
                    <Route index element={<Home />} />
                    <Route path="chat" element={<Chat />} />
                    <Route path="broadcast" element={<Broadcast />} />
                    <Route path="settings" element={<Settings />} />
                </Route>

                {/* Catch all - redirect to landing */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
