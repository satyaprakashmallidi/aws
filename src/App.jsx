import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, SignIn, SignUp } from "@clerk/clerk-react";
import Layout from './components/Layout';
import Home from './pages/Home';
import Chat from './pages/Chat';
import Broadcast from './pages/Broadcast';
import Landing from './pages/Landing';
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
                    element={<SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" afterSignInUrl="/app" />}
                />
                <Route
                    path="/sign-up/*"
                    element={<SignUp routing="path" path="/sign-up" signInUrl="/sign-in" afterSignUpUrl="/app" />}
                />

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
                </Route>

                {/* Catch all - redirect to landing */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
