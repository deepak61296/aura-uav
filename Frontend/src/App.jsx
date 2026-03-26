import React from 'react'
import {Routes, Route } from "react-router-dom";
import Layout from './Layout/Layout';
import Landing from './Pages/Landing';
import User from './Pages/User';
import Admin from './Pages/Admin';

const App = () => {
  return (
    <Routes>
      <Route element ={<Layout/>}>
        <Route path='/' element={<Landing/>}/>
        <Route path='/user' element={<User/>}/>
        <Route path='/admin' element={<Admin/>}/>
      </Route>
    </Routes>
  )
}

export default App

