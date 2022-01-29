import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

interface IRPS is IERC20 {
  function mint(address _to, uint256 _amount) external;

  function burn(address _from, uint256 _amount) external;
}
